package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/mouizahmed/justscribe-backend/internal/ai"
	"github.com/mouizahmed/justscribe-backend/internal/auth"
	calendarservice "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/handlers"
	"github.com/mouizahmed/justscribe-backend/internal/memory"
	"github.com/mouizahmed/justscribe-backend/internal/middleware"
	"github.com/mouizahmed/justscribe-backend/internal/profile"
	"github.com/mouizahmed/justscribe-backend/internal/queue"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/retrieval"
	"github.com/mouizahmed/justscribe-backend/internal/storage"
	"github.com/mouizahmed/justscribe-backend/internal/utils"
	"github.com/mouizahmed/justscribe-backend/internal/worker"
	"github.com/redis/go-redis/v9"
)

func init() {
	gin.SetMode(gin.ReleaseMode)
}

func allowedCORSOrigins() []string {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	if raw == "" {
		raw = "http://localhost:3000,http://localhost:3001,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:5173,https://orion.com,https://www.orion.com"
	}

	origins := make([]string, 0)
	for _, origin := range strings.Split(raw, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func trustedProxiesFromEnv() []string {
	raw := os.Getenv("TRUSTED_PROXIES")
	if raw == "" {
		return nil
	}

	proxies := make([]string, 0)
	for _, proxy := range strings.Split(raw, ",") {
		proxy = strings.TrimSpace(proxy)
		if proxy != "" {
			proxies = append(proxies, proxy)
		}
	}
	return proxies
}

func main() {
	err := godotenv.Load("cmd/api/.env")
	if err != nil {
		log.Fatal("Error loading cmd/api/.env file")
	}

	// Initialize encryption utilities
	if err := utils.InitEncryption(); err != nil {
		log.Fatalf("Failed to initialize encryption: %v", err)
	}

	// Initialize Firebase Admin SDK
	if err := auth.InitFirebase(); err != nil {
		log.Fatalf("Failed to initialize Firebase: %v", err)
	}

	// Initialize database
	db, err := database.New()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Initialize repositories
	userRepo := repository.NewUserRepository(db)
	authIdentityRepo := repository.NewUserAuthIdentityRepository(db)
	integrationConnectionRepo := repository.NewIntegrationConnectionRepository(db)
	calendarPreferenceRepo := repository.NewCalendarPreferenceRepository(db)
	calendarCacheRepo := repository.NewCalendarCacheRepository(db)
	noteRepo := repository.NewNoteRepository(db)
	noteVersionRepo := repository.NewNoteVersionRepository(db)
	folderRepo := repository.NewFolderRepository(db)
	recordingRepo := repository.NewRecordingSessionRepository(db)
	noteAttachmentRepo := repository.NewNoteAttachmentRepository(db)
	transcriptRepo := repository.NewTranscriptRepository(db)
	conversationRepo := repository.NewConversationRepository(db)
	messageRepo := repository.NewMessageRepository(db)

	// Initialize AI services
	aiClient := ai.NewClient()

	// Initialize embedder (graceful: nil if OPENAI_API_KEY not set)
	embedder, _ := memory.NewEmbedder()

	// Initialize Pinecone (graceful: nil if PINECONE_API_KEY not set)
	pineconeClient, _ := retrieval.NewClient(context.Background())

	// Initialize retriever
	retriever := retrieval.NewRetriever(embedder, pineconeClient, noteRepo)

	toolExecutor := ai.NewToolExecutor(noteRepo, transcriptRepo, folderRepo, db, retriever)

	b2Client, err := storage.NewB2Client()
	if err != nil {
		log.Fatalf("Failed to initialize B2 client: %v", err)
	}
	publicB2Client, err := storage.NewB2ClientFor(os.Getenv("B2_PUBLIC_BUCKET_NAME"), os.Getenv("B2_PUBLIC_BUCKET_ID"))
	if err != nil {
		log.Fatalf("Failed to initialize public B2 client: %v", err)
	}
	avatarService := profile.NewAvatarService(publicB2Client)

	// Initialize direct Redis client for OAuth codes
	redisClient := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_ADDR"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})

	// Test Redis connection
	if err := redisClient.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer redisClient.Close()

	// Initialize queue and worker
	indexQueue := queue.NewQueue(redisClient)
	w := worker.NewWorker(indexQueue, embedder, pineconeClient, noteRepo, transcriptRepo)
	workerCtx, cancelWorker := context.WithCancel(context.Background())
	defer cancelWorker()
	go w.Start(workerCtx)

	// Initialize handlers
	oauthHandler := handlers.NewOAuthHandler(userRepo, authIdentityRepo, redisClient, avatarService)
	integrationOAuthHandler := handlers.NewIntegrationOAuthHandler(integrationConnectionRepo, redisClient)
	userHandler := handlers.NewUserHandler(userRepo, avatarService)
	folderHandler := handlers.NewFoldersHandler(folderRepo)
	notesHandler := handlers.NewNotesHandler(noteRepo, noteVersionRepo, folderRepo, recordingRepo, b2Client, noteAttachmentRepo, aiClient, indexQueue)
	dashboardHandler := handlers.NewDashboardHandler(noteRepo)

	transcriptionHandler := handlers.NewTranscriptionHandler()
	transcriptHandler := handlers.NewTranscriptHandler(transcriptRepo, noteRepo, indexQueue)
	calendarSyncService := calendarservice.NewService(integrationConnectionRepo, calendarPreferenceRepo, calendarCacheRepo, redisClient)
	wsHub := handlers.NewWsHub()
	wsHandler := handlers.NewWsHandler(wsHub)
	calendarHandler := handlers.NewCalendarHandler(integrationConnectionRepo, calendarPreferenceRepo, calendarCacheRepo, calendarSyncService, wsHub)
	chatHandler := handlers.NewChatHandler(conversationRepo, messageRepo, aiClient, toolExecutor, retriever, indexQueue)
	aiTransformHandler := handlers.NewAITransformHandler(aiClient)

	// Initialize the router
	router := gin.Default()
	if err := router.SetTrustedProxies(trustedProxiesFromEnv()); err != nil {
		log.Fatalf("Failed to configure trusted proxies: %v", err)
	}

	// Configure CORS
	router.Use(cors.New(cors.Config{
		AllowOrigins:     allowedCORSOrigins(),
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "Cache-Control", "Connection", "Access-Control-Allow-Origin", "svix-id", "svix-timestamp", "svix-signature"},
		ExposeHeaders:    []string{"Content-Length", "Content-Type", "Cache-Control", "Content-Encoding", "Transfer-Encoding"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// API Routes
	api := router.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": "ok"})
		})
		api.GET("/transcription/stream", transcriptionHandler.Stream)
		api.GET("/ws", wsHandler.Handle)
	}

	// OAuth routes (no auth required)
	auth := router.Group("/auth")
	{
		auth.GET("/start", oauthHandler.StartOAuth)
		auth.POST("/cancel", oauthHandler.CancelOAuth)
		auth.GET("/callback", oauthHandler.HandleCallback)
		auth.POST("/complete", oauthHandler.CompleteAuth) // Complete auth with one-time code
	}

	integrations := router.Group("/integrations")
	{
		integrations.GET("/oauth/callback", integrationOAuthHandler.HandleCallback)
	}

	// Authenticated API routes
	authenticated := api.Group("/")
	authenticated.Use(middleware.FirebaseAuthMiddleware())
	{
		// Auth routes (require Firebase auth)
		authenticated.POST("/auth/logout", oauthHandler.Logout)

		// Integration connection routes
		authenticated.POST("/integrations/connections/start", integrationOAuthHandler.StartConnection)
		authenticated.GET("/integrations/connections", integrationOAuthHandler.ListConnections)
		authenticated.DELETE("/integrations/connections/:connectionID", integrationOAuthHandler.DisconnectConnection)

		// User routes
		authenticated.GET("/user/me", userHandler.GetCurrentUser)
		authenticated.PATCH("/user/me", userHandler.UpdateCurrentUser)
		authenticated.POST("/user/me/avatar", userHandler.UploadAvatar)

		// Dashboard routes
		authenticated.GET("/dashboard/activity", dashboardHandler.ListActivity)

		// Notes routes
		authenticated.GET("/search", notesHandler.Search)
		authenticated.GET("/notes", notesHandler.ListNotes)
		authenticated.GET("/notes/by-event", notesHandler.GetNotesByEvent)
		authenticated.GET("/notes/:noteID", notesHandler.GetNote)
		authenticated.POST("/notes", notesHandler.CreateNote)
		authenticated.PATCH("/notes/:noteID", notesHandler.UpdateNote)
		authenticated.DELETE("/notes/:noteID", notesHandler.DeleteNote)
		authenticated.POST("/notes/:noteID/enhance", notesHandler.EnhanceNote)
		authenticated.GET("/notes/:noteID/versions", notesHandler.ListVersions)
		authenticated.POST("/notes/:noteID/revert/:versionID", notesHandler.RevertToVersion)
		authenticated.POST("/notes/:noteID/images", notesHandler.UploadImage)
		authenticated.GET("/notes/:noteID/images/:imageID", notesHandler.ProxyImage)
		authenticated.DELETE("/notes/:noteID/images/:imageID", notesHandler.DeleteImage)
		authenticated.POST("/notes/:noteID/recording/start", notesHandler.StartRecording)
		authenticated.POST("/notes/:noteID/recording/:sessionID/stop", notesHandler.StopRecording)

		// Folder routes
		authenticated.GET("/folders", folderHandler.ListFolders)
		authenticated.POST("/folders", folderHandler.CreateFolder)
		authenticated.PATCH("/folders/:folderID", folderHandler.RenameFolder)
		authenticated.DELETE("/folders/:folderID", folderHandler.DeleteFolder)

		// Transcript routes
		authenticated.POST("/notes/:noteID/transcript/segments", transcriptHandler.SaveSegments)
		authenticated.GET("/notes/:noteID/transcript/segments", transcriptHandler.GetSegments)
		authenticated.GET("/transcript/search", transcriptHandler.SearchSegments)

		// Calendar routes
		authenticated.GET("/calendar/calendars", calendarHandler.GetCalendars)
		authenticated.GET("/calendar/upcoming", calendarHandler.GetUpcomingEvents)
		authenticated.GET("/calendar/events/linked", calendarHandler.GetLinkedEvent)
		authenticated.GET("/calendar/events/search", calendarHandler.SearchEvents)
		authenticated.POST("/calendar/sync", calendarHandler.Sync)
		authenticated.PATCH("/calendar/connections/:connectionID/calendars/:calendarID", calendarHandler.UpdateCalendarVisibility)

		// Chat routes
		authenticated.POST("/chat/conversations", chatHandler.CreateConversation)
		authenticated.GET("/chat/conversations", chatHandler.ListConversations)
		authenticated.DELETE("/chat/conversations/:conversationID", chatHandler.DeleteConversation)
		authenticated.PATCH("/chat/conversations/:conversationID", chatHandler.RenameConversation)
		authenticated.GET("/chat/conversations/:conversationID/messages", chatHandler.GetMessages)
		authenticated.POST("/chat/conversations/:conversationID/messages", chatHandler.SendMessage)

		// AI transform route
		authenticated.POST("/ai/transform", aiTransformHandler.Transform)

	}

	// Start the server
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080" // Default port if not specified
	}
	log.Printf("Starting server on port %s", port)

	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	} else {
		log.Printf("Server started on port %s", port)
	}
}
