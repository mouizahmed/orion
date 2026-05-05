package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/profile"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

const maxDisplayNameLength = 120

type UserHandler struct {
	userRepo      *repository.UserRepository
	avatarService *profile.AvatarService
}

func NewUserHandler(userRepo *repository.UserRepository, avatarService *profile.AvatarService) *UserHandler {
	return &UserHandler{
		userRepo:      userRepo,
		avatarService: avatarService,
	}
}

type updateCurrentUserRequest struct {
	Name string `json:"name"`
}

func renderUser(c *gin.Context, user *models.User) {
	c.JSON(http.StatusOK, gin.H{
		"id":         user.ID,
		"email":      user.Email,
		"name":       user.Name,
		"avatar_url": user.AvatarURL,
		"plan":       user.Plan,
		"status":     user.Status,
		"created_at": user.CreatedAt,
		"updated_at": user.UpdatedAt,
	})
}

// GetCurrentUser returns the current authenticated user's information
func (h *UserHandler) GetCurrentUser(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Fetch user from database
	user, err := h.userRepo.GetUserByID(userID)
	if err != nil {
		if err.Error() == "user not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user information"})
		return
	}

	renderUser(c, user)
}

func (h *UserHandler) UpdateCurrentUser(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var req updateCurrentUserRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}
	if len([]rune(name)) > maxDisplayNameLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is too long"})
		return
	}

	if err := h.userRepo.UpdateName(userID, name); err != nil {
		if err.Error() == "user not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user profile"})
		return
	}

	user, err := h.userRepo.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user information"})
		return
	}

	renderUser(c, user)
}

func (h *UserHandler) UploadAvatar(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	if h.avatarService == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Avatar storage is not configured"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar image is required"})
		return
	}
	if fileHeader.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar image is empty"})
		return
	}
	if fileHeader.Size > profile.MaxAvatarBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar image is too large"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open avatar image"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, profile.MaxAvatarBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read avatar image"})
		return
	}
	if len(data) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar image is empty"})
		return
	}
	if len(data) > profile.MaxAvatarBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar image is too large"})
		return
	}

	mimeType := fileHeader.Header.Get("Content-Type")
	if !profile.IsSupportedAvatarMimeType(mimeType) {
		mimeType = http.DetectContentType(data)
	}
	if !profile.IsSupportedAvatarMimeType(mimeType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported avatar image type"})
		return
	}

	avatarURL, err := h.avatarService.UploadUserAvatar(userID, data, mimeType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload avatar image"})
		return
	}
	if err := h.userRepo.UpdateAvatarURL(userID, avatarURL); err != nil {
		if err.Error() == "user not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user avatar"})
		return
	}

	user, err := h.userRepo.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user information"})
		return
	}

	renderUser(c, user)
}
