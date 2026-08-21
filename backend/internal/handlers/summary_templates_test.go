package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/auth"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

type fakeSummaryTemplateRepository struct{ created *models.SummaryTemplate }

func (f *fakeSummaryTemplateRepository) List(context.Context, string) ([]models.SummaryTemplate, error) {
	return []models.SummaryTemplate{}, nil
}
func (f *fakeSummaryTemplateRepository) Create(_ context.Context, accountID string, input repository.SummaryTemplateInput) (*models.SummaryTemplate, error) {
	f.created = &models.SummaryTemplate{ID: uuid.NewString(), AccountID: accountID, Name: input.Name, Prompt: input.Prompt, Folders: []models.SummaryTemplateFolder{}}
	return f.created, nil
}
func (f *fakeSummaryTemplateRepository) Update(context.Context, string, string, repository.SummaryTemplateInput) (*models.SummaryTemplate, error) {
	return nil, repository.ErrSummaryTemplateNotFound
}
func (f *fakeSummaryTemplateRepository) Delete(context.Context, string, string) error { return nil }

type summaryTemplateRecordingPublisher struct{ resources []resourceevents.Resource }

func (p *summaryTemplateRecordingPublisher) PublishChanged(_ context.Context, _ string, resource resourceevents.Resource, _ *string) error {
	p.resources = append(p.resources, resource)
	return nil
}

func validSummaryTemplateRequest() summaryTemplateRequest {
	return summaryTemplateRequest{
		Name: " Sales call ", Prompt: " Summarize decisions. ", FolderIDs: []string{uuid.NewString(), uuid.NewString()},
	}
}

func TestNormalizeSummaryTemplateRequest(t *testing.T) {
	request := validSummaryTemplateRequest()
	input, err := normalizeSummaryTemplateRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	if input.Name != "Sales call" || input.Prompt != "Summarize decisions." || len(input.FolderIDs) != 2 {
		t.Fatalf("unexpected normalized input: %+v", input)
	}
}

func TestNormalizeSummaryTemplateRequestRejectsInvalidValues(t *testing.T) {
	folderID := uuid.NewString()
	tests := []struct {
		name     string
		mutate   func(*summaryTemplateRequest)
		wantCode string
	}{
		{"blank name", func(r *summaryTemplateRequest) { r.Name = "  " }, "summary_template_name_invalid"},
		{"long prompt", func(r *summaryTemplateRequest) { r.Prompt = strings.Repeat("a", maxSummaryTemplatePromptLength+1) }, "summary_template_prompt_invalid"},
		{"empty folders", func(r *summaryTemplateRequest) { r.FolderIDs = nil }, "summary_template_folders_invalid"},
		{"invalid folder", func(r *summaryTemplateRequest) { r.FolderIDs = []string{"bad"} }, "summary_template_folder_invalid"},
		{"duplicate folder", func(r *summaryTemplateRequest) { r.FolderIDs = []string{folderID, folderID} }, "summary_template_duplicate_folder"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validSummaryTemplateRequest()
			test.mutate(&request)
			_, err := normalizeSummaryTemplateRequest(request)
			var validation *summaryTemplateValidationError
			if !errors.As(err, &validation) || validation.Code != test.wantCode {
				t.Fatalf("got %v, want %s", err, test.wantCode)
			}
		})
	}
}

func TestSummaryTemplateCreatePublishesAfterSuccessAndListDoesNot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	accountID := uuid.NewString()
	repo := &fakeSummaryTemplateRepository{}
	publisher := &summaryTemplateRecordingPublisher{}
	handler := NewSummaryTemplatesHandler(repo, publisher)

	createRecorder := httptest.NewRecorder()
	createContext, _ := gin.CreateTestContext(createRecorder)
	createContext.Set("authPrincipal", &auth.Principal{User: &models.User{ID: accountID}})
	createContext.Request = httptest.NewRequest(http.MethodPost, "/api/summary-templates", strings.NewReader(`{
		"name":"Sales call","prompt":"Summarize decisions","folder_ids":["`+uuid.NewString()+`"]
	}`))
	createContext.Request.Header.Set("Content-Type", "application/json")
	handler.Create(createContext)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create returned %d: %s", createRecorder.Code, createRecorder.Body.String())
	}
	if len(publisher.resources) != 1 || publisher.resources[0] != resourceevents.ResourceSummaryTemplates {
		t.Fatalf("unexpected published resources: %v", publisher.resources)
	}

	listRecorder := httptest.NewRecorder()
	listContext, _ := gin.CreateTestContext(listRecorder)
	listContext.Set("authPrincipal", &auth.Principal{User: &models.User{ID: accountID}})
	listContext.Request = httptest.NewRequest(http.MethodGet, "/api/summary-templates", nil)
	handler.List(listContext)
	if listRecorder.Code != http.StatusOK || len(publisher.resources) != 1 {
		t.Fatalf("list status=%d resources=%v", listRecorder.Code, publisher.resources)
	}
}

func TestSummaryTemplateFolderConflictResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	renderSummaryTemplateRepositoryError(context, repository.ErrSummaryTemplateFolderConflict)
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "summary_template_folder_conflict") {
		t.Fatalf("unexpected response %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestSummaryTemplateLimitResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	renderSummaryTemplateRepositoryError(context, repository.ErrSummaryTemplateLimitReached)
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "summary_template_limit_reached") {
		t.Fatalf("unexpected response %d: %s", recorder.Code, recorder.Body.String())
	}
}
