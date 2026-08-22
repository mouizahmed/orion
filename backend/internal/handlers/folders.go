package handlers

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

type FoldersHandler struct {
	folderRepo *repository.FolderRepository
	events     resourceevents.Publisher
}

type CreateFolderRequest struct {
	Name string `json:"name"`
}

type RenameFolderRequest struct {
	Name string `json:"name"`
}

func NewFoldersHandler(folderRepo *repository.FolderRepository, events resourceevents.Publisher) *FoldersHandler {
	return &FoldersHandler{folderRepo: folderRepo, events: events}
}

func (h *FoldersHandler) ListFolders(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	folders, err := h.folderRepo.ListFolders(userID)
	if err != nil {
		log.Printf("folders: failed to list for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load folders"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"folders": folders})
}

func (h *FoldersHandler) CreateFolder(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var req CreateFolderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder name is required"})
		return
	}

	created, err := h.folderRepo.CreateFolder(userID, name)
	if err != nil {
		log.Printf("folders: failed to create for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create folder"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceFolders, &created.ID)

	c.JSON(http.StatusOK, gin.H{"folder": created})
}

func (h *FoldersHandler) RenameFolder(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	folderID := strings.TrimSpace(c.Param("folderID"))
	if folderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder id is required"})
		return
	}

	var req RenameFolderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder name is required"})
		return
	}

	updated, err := h.folderRepo.RenameFolder(userID, folderID, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceFolders, &folderID)

	c.JSON(http.StatusOK, gin.H{"folder": updated})
}

func (h *FoldersHandler) DeleteFolder(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	folderID := strings.TrimSpace(c.Param("folderID"))
	if folderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder id is required"})
		return
	}

	deleted, err := h.folderRepo.DeleteFolder(userID, folderID)
	if err != nil {
		log.Printf("folders: failed to delete %s: %v", folderID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete folder"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceFolders, &folderID)

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
