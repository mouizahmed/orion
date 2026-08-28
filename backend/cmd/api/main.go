package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/mouizahmed/justscribe-backend/internal/ai"
	"github.com/mouizahmed/justscribe-backend/internal/auth"
	"github.com/mouizahmed/justscribe-backend/internal/billing"
	calendarservice "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/email"
	"github.com/mouizahmed/justscribe-backend/internal/handlers"
	"github.com/mouizahmed/justscribe-backend/internal/integrationworker"
	"github.com/mouizahmed/justscribe-backend/internal/memory"
	"github.com/mouizahmed/justscribe-backend/internal/middleware"
	"github.com/mouizahmed/justscribe-backend/internal/profile"
	"github.com/mouizahmed/justscribe-backend/internal/queue"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
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
		raw = "http://localhost:3000,http://localhost:3001,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:5173,https://orion.app,https://www.orion.app"
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
	for _, envFile := range []string{"cmd/api/.env", "cmd/api/.env.billing"} {
		if err := godotenv.Load(envFile); err != nil && !os.IsNotExist(err) {
			log.Fatalf("Failed to load %s: %v", envFile, err)
		}
	}
	authConfig, err := auth.LoadConfig()
	if err != nil {
		log.Fatalf("Invalid authentication configuration: %v", err)
	}
	if err := auth.ValidateIntegrationConfiguration(); err != nil {
		log.Fatalf("Invalid integration OAuth configuration: %v", err)
	}
	billingConfig, err := billing.LoadConfig()
	if err != nil {
		log.Fatalf("Invalid Stripe billing configuration: %v", err)
	}
	billingRuntime := billing.NewRuntime(billingConfig)
	if billingRuntime.Enabled() {
		log.Printf("Stripe billing enabled in %s mode", billingRuntime.Mode())
	} else {
		log.Printf("Stripe billing disabled")
	}

	// Initialize encryption utilities
	if err := utils.InitEncryption(); err != nil {
		log.Fatalf("Failed to initialize encryption: %v", err)
	}

	supabaseAuth := auth.NewSupabaseClient(authConfig)

	// Initialize database
	db, err := database.New()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Initialize repositories
	userRepo := repository.NewUserRepository(db, billingConfig.Enabled, billingConfig.Livemode())
	principalService := auth.NewPrincipalService(supabaseAuth, userRepo)
	integrationConnectionRepo := repository.NewIntegrationConnectionRepository(db)
	calendarPreferenceRepo := repository.NewCalendarPreferenceRepository(db)
	calendarCacheRepo := repository.NewCalendarCacheRepository(db)
	integrationControlPlaneRepo := repository.NewIntegrationControlPlaneRepository(db)
	calendarSyncService := calendarservice.NewService(integrationConnectionRepo, calendarPreferenceRepo, calendarCacheRepo)
	noteRepo := repository.NewNoteRepository(db)
	noteVersionRepo := repository.NewNoteVersionRepository(db)
	folderRepo := repository.NewFolderRepository(db)
	recordingRepo := repository.NewRecordingSessionRepository(db)
	noteAttachmentRepo := repository.NewNoteAttachmentRepository(db)
	noteAttendeeRepo := repository.NewNoteAttendeeRepository(db)
	transcriptRepo := repository.NewTranscriptRepository(db)
	conversationRepo := repository.NewConversationRepository(db)
	messageRepo := repository.NewMessageRepository(db)
	accountUsageRepo := repository.NewAccountUsageRepository(db)
	accountVocabularyRepo := repository.NewAccountVocabularyRepository(db)
	emailDraftSettingsRepo := repository.NewEmailDraftSettingsRepository(db)
	extractFieldRepo := repository.NewExtractFieldRepository(db)
	summaryTemplateRepo := repository.NewSummaryTemplateRepository(db)
	billingCustomerRepo := repository.NewBillingCustomerRepository(db)
	subscriptionRepo := repository.NewSubscriptionRepository(db)
	billingWebhookRepo := repository.NewBillingWebhookRepository(db)
	billingCustomerService := billing.NewCustomerService(billingRuntime, billingCustomerRepo)
	billingWebhookService := billing.NewWebhookService(billingRuntime, billingWebhookRepo)

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
	resourceEventMetrics := resourceevents.NewMetrics()
	resourceEventPublisher := resourceevents.NewPublisher(redisClient, resourceEventMetrics)
	wsHub := handlers.NewWsHub()
	resourceEventSubscriber := resourceevents.NewSubscriber(redisClient, func(accountID string, change resourceevents.Change) int {
		return wsHub.SendToUser(accountID, map[string]any{
			"type": "resource.changed",
			"data": change,
		})
	}, resourceEventMetrics)
	billingEventProcessor := billing.NewEventProcessor(billingRuntime, billingCustomerRepo, subscriptionRepo, billingWebhookRepo, resourceEventPublisher)
	billingReconciler := billing.NewReconciler(billingRuntime, billingCustomerRepo, subscriptionRepo, billingEventProcessor)
	billingRateLimiter := billing.NewRateLimiter(redisClient)
	checkoutService := billing.NewCheckoutService(billingRuntime, billingCustomerService, subscriptionRepo, billingRateLimiter)
	portalService := billing.NewPortalService(billingRuntime, billingCustomerRepo, billingRateLimiter)
	billingStatusService := billing.NewStatusService(billingRuntime, subscriptionRepo)

	// Initialize queue and worker
	indexQueue := queue.NewQueue(redisClient)
	w := worker.NewWorker(indexQueue, embedder, pineconeClient, noteRepo, transcriptRepo)
	integrationWorker := integrationworker.New(integrationControlPlaneRepo, calendarSyncService, resourceEventPublisher, func(userID string, syncing, stale bool) {
		wsHub.SendToUser(userID, map[string]any{
			"type": "calendar.sync_status",
			"data": map[string]any{"syncing": syncing, "stale": stale},
		})
	})
	workerCtx, cancelWorker := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancelWorker()
	go w.Start(workerCtx)
	go integrationWorker.Start(workerCtx)
	go billingEventProcessor.Start(workerCtx)
	go billingReconciler.Start(workerCtx)
	resourceEventSubscriberDone := make(chan struct{})
	go func() {
		defer close(resourceEventSubscriberDone)
		resourceEventSubscriber.Run(workerCtx)
	}()

	// Initialize email service
	emailSvc := email.NewService(os.Getenv("RESEND_API_KEY"), email.Config{
		NoReply: os.Getenv("EMAIL_NOREPLY"),
		Billing: os.Getenv("EMAIL_BILLING"),
	})

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(principalService, supabaseAuth, emailSvc, wsHub)
	integrationOAuthHandler := handlers.NewIntegrationOAuthHandler(integrationConnectionRepo, redisClient, resourceEventPublisher)
	userHandler := handlers.NewUserHandler(userRepo, avatarService)
	vocabularyHandler := handlers.NewVocabularyHandler(accountVocabularyRepo, resourceEventPublisher)
	emailDraftSettingsHandler := handlers.NewEmailDraftSettingsHandler(emailDraftSettingsRepo, resourceEventPublisher)
	extractFieldsHandler := handlers.NewExtractFieldsHandler(extractFieldRepo, resourceEventPublisher)
	summaryTemplatesHandler := handlers.NewSummaryTemplatesHandler(summaryTemplateRepo, resourceEventPublisher)
	billingHandler := handlers.NewBillingHandler(checkoutService, portalService, billingStatusService, billingWebhookService)
	folderHandler := handlers.NewFoldersHandler(folderRepo, resourceEventPublisher)
	notesHandler := handlers.NewNotesHandler(noteRepo, noteVersionRepo, folderRepo, recordingRepo, b2Client, noteAttachmentRepo, noteAttendeeRepo, aiClient, indexQueue, resourceEventPublisher)
	noteAttendeesHandler := handlers.NewNoteAttendeesHandler(noteRepo, noteAttendeeRepo, resourceEventPublisher)
	dashboardHandler := handlers.NewDashboardHandler(noteRepo)

	transcriptionHandler := handlers.NewTranscriptionHandler(principalService, accountUsageRepo, accountVocabularyRepo, wsHub)
	transcriptHandler := handlers.NewTranscriptHandler(transcriptRepo, noteRepo, indexQueue)
	wsHandler := handlers.NewWsHandler(wsHub, principalService)
	calendarHandler := handlers.NewCalendarHandler(integrationConnectionRepo, calendarPreferenceRepo, calendarCacheRepo, calendarSyncService, integrationControlPlaneRepo, wsHub, resourceEventPublisher)
	chatHandler := handlers.NewChatHandler(conversationRepo, messageRepo, aiClient, toolExecutor, retriever, indexQueue, resourceEventPublisher)
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
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "Cache-Control", "Connection", "svix-id", "svix-timestamp", "svix-signature"},
		ExposeHeaders:    []string{"Content-Length", "Content-Type", "Cache-Control", "Content-Encoding", "Transfer-Encoding"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	// API Routes
	api := router.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": "ok"})
		})
		api.POST("/auth/session", authHandler.Session)
		api.GET("/transcription/stream", transcriptionHandler.Stream)
		api.GET("/ws", wsHandler.Handle)
	}

	integrations := router.Group("/integrations")
	{
		integrations.GET("/oauth/callback", integrationOAuthHandler.HandleCallback)
	}

	// Stripe authenticates this endpoint with its request signature, not a user session.
	router.POST("/webhooks/stripe", billingHandler.ReceiveStripeWebhook)

	// Authenticated API routes
	authenticated := api.Group("/")
	authenticated.Use(middleware.AuthMiddleware(principalService))
	{
		// Auth routes require an active managed Supabase session and Orion user.
		authenticated.POST("/auth/logout-all", authHandler.LogoutAllDevices)

		// Integration connection routes
		authenticated.POST("/integrations/connections/start", integrationOAuthHandler.StartConnection)
		authenticated.GET("/integrations/connections", integrationOAuthHandler.ListConnections)
		authenticated.DELETE("/integrations/connections/:connectionID", integrationOAuthHandler.DisconnectConnection)

		// User routes
		authenticated.GET("/user/me", userHandler.GetCurrentUser)
		authenticated.PATCH("/user/me", userHandler.UpdateCurrentUser)
		authenticated.POST("/user/me/avatar", userHandler.UploadAvatar)
		authenticated.POST("/user/me/avatar/provider", userHandler.ImportProviderAvatar)

		// Vocabulary is account-owned and is never accepted through a stream handshake.
		authenticated.GET("/vocabulary", vocabularyHandler.Get)
		authenticated.PUT("/vocabulary", vocabularyHandler.Put)

		// Email Draft is configuration only; generation and provider delivery are deferred.
		authenticated.GET("/email-draft-settings", emailDraftSettingsHandler.Get)
		authenticated.PATCH("/email-draft-settings", emailDraftSettingsHandler.Patch)

		// Extract fields are configuration only; meeting processing does not consume them yet.
		authenticated.GET("/extract-fields", extractFieldsHandler.List)
		authenticated.POST("/extract-fields", extractFieldsHandler.Create)
		authenticated.PATCH("/extract-fields/:fieldID", extractFieldsHandler.Update)
		authenticated.DELETE("/extract-fields/:fieldID", extractFieldsHandler.Delete)

		// Summary templates are configuration only; meeting processing does not consume them yet.
		authenticated.GET("/summary-templates", summaryTemplatesHandler.List)
		authenticated.POST("/summary-templates", summaryTemplatesHandler.Create)
		authenticated.PATCH("/summary-templates/:templateID", summaryTemplatesHandler.Update)
		authenticated.DELETE("/summary-templates/:templateID", summaryTemplatesHandler.Delete)

		// Billing routes return hosted Stripe URLs only. Provider callbacks never grant access.
		authenticated.POST("/billing/checkout-sessions", billingHandler.CreateCheckoutSession)
		authenticated.POST("/billing/portal-sessions", billingHandler.CreatePortalSession)
		authenticated.GET("/billing/status", billingHandler.GetStatus)

		// Dashboard routes
		authenticated.GET("/dashboard/activity", dashboardHandler.ListActivity)

		// Notes routes
		authenticated.GET("/search", notesHandler.Search)
		authenticated.GET("/notes", notesHandler.ListNotes)
		authenticated.GET("/notes/by-event", notesHandler.GetNotesByEvent)
		authenticated.GET("/notes/:noteID", notesHandler.GetNote)
		authenticated.POST("/notes", notesHandler.CreateNote)
		authenticated.PATCH("/notes/:noteID", notesHandler.UpdateNote)
		authenticated.PUT("/notes/:noteID/calendar-link", notesHandler.UpdateCalendarLink)
		authenticated.DELETE("/notes/:noteID", notesHandler.DeleteNote)
		authenticated.POST("/notes/:noteID/enhance", notesHandler.EnhanceNote)
		authenticated.GET("/notes/:noteID/versions", notesHandler.ListVersions)
		authenticated.POST("/notes/:noteID/revert/:versionID", notesHandler.RevertToVersion)
		authenticated.POST("/notes/:noteID/images", notesHandler.UploadImage)
		authenticated.GET("/notes/:noteID/images/:imageID", notesHandler.ProxyImage)
		authenticated.DELETE("/notes/:noteID/images/:imageID", notesHandler.DeleteImage)
		authenticated.POST("/notes/:noteID/recording/start", notesHandler.StartRecording)
		authenticated.POST("/notes/:noteID/recording/:sessionID/stop", notesHandler.StopRecording)

		// Note attendee routes
		authenticated.GET("/notes/:noteID/attendees", noteAttendeesHandler.ListAttendees)
		authenticated.POST("/notes/:noteID/attendees", noteAttendeesHandler.AddAttendee)
		authenticated.DELETE("/notes/:noteID/attendees/:email", noteAttendeesHandler.RemoveAttendee)

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
	host := strings.TrimSpace(os.Getenv("API_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	address := net.JoinHostPort(host, port)
	log.Printf("Starting server on %s", address)

	server := &http.Server{
		Addr:              address,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("Failed to start server: %v", err)
		}
		cancelWorker()
	case <-workerCtx.Done():
		shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelShutdown()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Server shutdown failed: %v", err)
		}
		if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("Server stopped with an error: %v", err)
		}
	}

	cancelWorker()
	select {
	case <-resourceEventSubscriberDone:
	case <-time.After(2 * time.Second):
		log.Printf("resource events: subscriber shutdown timed out")
	}
}
