package handlers

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

type PeopleHandler struct {
	peopleRepo *repository.PersonRepository
	events     resourceevents.Publisher
}

func NewPeopleHandler(peopleRepo *repository.PersonRepository, events resourceevents.Publisher) *PeopleHandler {
	return &PeopleHandler{peopleRepo: peopleRepo, events: events}
}

type CreatePersonRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (h *PeopleHandler) List(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	people, err := h.peopleRepo.List(c.Request.Context(), userID)
	if err != nil {
		log.Printf("people: failed to list for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load people"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"people": people})
}

func (h *PeopleHandler) Create(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var request CreatePersonRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}
	name := strings.TrimSpace(request.Name)
	email := strings.ToLower(strings.TrimSpace(request.Email))
	if len([]rune(name)) > maxDisplayNameLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is too long"})
		return
	}
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}
	if len(email) > 320 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is too long"})
		return
	}
	if !emailRegex.MatchString(email) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email address"})
		return
	}

	person, err := h.peopleRepo.Create(c.Request.Context(), userID, name, email)
	if err != nil {
		if errors.Is(err, repository.ErrPersonExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "person already exists"})
			return
		}
		log.Printf("people: failed to create for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create person"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourcePeople, &person.ID)
	c.JSON(http.StatusCreated, gin.H{"person": person})
}

func (h *PeopleHandler) Delete(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	personID := strings.TrimSpace(c.Param("personID"))
	if _, err := uuid.Parse(personID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid person id"})
		return
	}

	deleted, err := h.peopleRepo.Delete(c.Request.Context(), userID, personID)
	if err != nil {
		log.Printf("people: failed to delete %s: %v", personID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete person"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "person not found"})
		return
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourcePeople, &personID)
	c.Status(http.StatusNoContent)
}
