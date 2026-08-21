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

type fakeExtractFieldRepository struct {
	created *models.ExtractField
}

func (f *fakeExtractFieldRepository) List(context.Context, string) ([]models.ExtractField, error) {
	return []models.ExtractField{}, nil
}
func (f *fakeExtractFieldRepository) Create(_ context.Context, accountID string, input repository.ExtractFieldInput) (*models.ExtractField, error) {
	f.created = &models.ExtractField{ID: uuid.NewString(), AccountID: accountID, Name: input.Name, Prompt: input.Prompt, InsightCardinality: input.InsightCardinality, Scope: models.ExtractFieldScope{Type: input.ScopeType, Folders: []models.ExtractFieldFolder{}}}
	return f.created, nil
}
func (f *fakeExtractFieldRepository) Update(context.Context, string, string, repository.ExtractFieldInput) (*models.ExtractField, error) {
	return nil, repository.ErrExtractFieldNotFound
}
func (f *fakeExtractFieldRepository) Delete(context.Context, string, string) error { return nil }

type extractRecordingPublisher struct {
	resources []resourceevents.Resource
}

func (p *extractRecordingPublisher) PublishChanged(_ context.Context, _ string, resource resourceevents.Resource, _ *string) error {
	p.resources = append(p.resources, resource)
	return nil
}

func validExtractFieldRequest() extractFieldRequest {
	return extractFieldRequest{
		Name: " Pain points ", Prompt: " What pain points exist? ", InsightCardinality: "multiple",
		Scope: extractFieldScopeRequest{Type: models.ExtractScopeAllMeetings, FolderIDs: []string{}},
	}
}

func TestNormalizeExtractFieldRequest(t *testing.T) {
	request := validExtractFieldRequest()
	input, err := normalizeExtractFieldRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	if input.Name != "Pain points" || input.Prompt != "What pain points exist?" || len(input.FolderIDs) != 0 {
		t.Fatalf("unexpected normalized input: %+v", input)
	}

	request.Scope = extractFieldScopeRequest{Type: models.ExtractScopeFolders, FolderIDs: []string{uuid.NewString(), uuid.NewString()}}
	input, err = normalizeExtractFieldRequest(request)
	if err != nil || len(input.FolderIDs) != 2 {
		t.Fatalf("valid multi-folder scope rejected: input=%+v err=%v", input, err)
	}
}

func TestNormalizeExtractFieldRequestRejectsInvalidValues(t *testing.T) {
	folderID := uuid.NewString()
	tests := []struct {
		name     string
		mutate   func(*extractFieldRequest)
		wantCode string
	}{
		{"blank name", func(r *extractFieldRequest) { r.Name = "  " }, "extract_field_name_invalid"},
		{"long prompt", func(r *extractFieldRequest) { r.Prompt = strings.Repeat("a", maxExtractFieldPromptLength+1) }, "extract_field_prompt_invalid"},
		{"cardinality", func(r *extractFieldRequest) { r.InsightCardinality = "many" }, "extract_field_cardinality_invalid"},
		{"all with folder", func(r *extractFieldRequest) { r.Scope.FolderIDs = []string{folderID} }, "extract_field_scope_invalid"},
		{"empty folders", func(r *extractFieldRequest) { r.Scope = extractFieldScopeRequest{Type: models.ExtractScopeFolders} }, "extract_field_scope_invalid"},
		{"invalid folder", func(r *extractFieldRequest) {
			r.Scope = extractFieldScopeRequest{Type: models.ExtractScopeFolders, FolderIDs: []string{"bad"}}
		}, "extract_field_folder_invalid"},
		{"duplicate folder", func(r *extractFieldRequest) {
			r.Scope = extractFieldScopeRequest{Type: models.ExtractScopeFolders, FolderIDs: []string{folderID, folderID}}
		}, "extract_field_duplicate_folder"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validExtractFieldRequest()
			test.mutate(&request)
			_, err := normalizeExtractFieldRequest(request)
			var validation *extractFieldValidationError
			if !errors.As(err, &validation) || validation.Code != test.wantCode {
				t.Fatalf("got %v, want %s", err, test.wantCode)
			}
		})
	}
}

func TestExtractFieldCreatePublishesAfterSuccessAndListDoesNot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	accountID := uuid.NewString()
	repo := &fakeExtractFieldRepository{}
	publisher := &extractRecordingPublisher{}
	handler := NewExtractFieldsHandler(repo, publisher)

	createRecorder := httptest.NewRecorder()
	createContext, _ := gin.CreateTestContext(createRecorder)
	createContext.Set("authPrincipal", &auth.Principal{User: &models.User{ID: accountID}})
	createContext.Request = httptest.NewRequest(http.MethodPost, "/api/extract-fields", strings.NewReader(`{
		"name":"Pain points","prompt":"Find pain points","insight_cardinality":"multiple",
		"scope":{"type":"folders","folder_ids":["`+uuid.NewString()+`","`+uuid.NewString()+`"]}
	}`))
	createContext.Request.Header.Set("Content-Type", "application/json")
	handler.Create(createContext)
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create returned %d: %s", createRecorder.Code, createRecorder.Body.String())
	}
	if len(publisher.resources) != 1 || publisher.resources[0] != resourceevents.ResourceExtractFields {
		t.Fatalf("unexpected published resources: %v", publisher.resources)
	}

	listRecorder := httptest.NewRecorder()
	listContext, _ := gin.CreateTestContext(listRecorder)
	listContext.Set("authPrincipal", &auth.Principal{User: &models.User{ID: accountID}})
	listContext.Request = httptest.NewRequest(http.MethodGet, "/api/extract-fields", nil)
	handler.List(listContext)
	if listRecorder.Code != http.StatusOK || len(publisher.resources) != 1 {
		t.Fatalf("list status=%d resources=%v", listRecorder.Code, publisher.resources)
	}
}

func TestExtractFieldLimitResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	renderExtractFieldRepositoryError(context, repository.ErrExtractFieldLimitReached)
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "extract_field_limit_reached") {
		t.Fatalf("unexpected response %d: %s", recorder.Code, recorder.Body.String())
	}
}
