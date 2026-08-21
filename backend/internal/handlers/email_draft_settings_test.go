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

type fakeEmailDraftSettingsRepository struct {
	getResult     *repository.EmailDraftSettings
	getErr        error
	patchResult   *repository.EmailDraftSettings
	patchErr      error
	getCalls      int
	patchCalls    int
	accountID     string
	patch         repository.EmailDraftSettingsPatch
	defaultPrompt string
}

func (f *fakeEmailDraftSettingsRepository) Get(context.Context, string) (*repository.EmailDraftSettings, error) {
	f.getCalls++
	return f.getResult, f.getErr
}

func (f *fakeEmailDraftSettingsRepository) Patch(
	_ context.Context,
	accountID string,
	patch repository.EmailDraftSettingsPatch,
	defaultPrompt string,
) (*repository.EmailDraftSettings, error) {
	f.patchCalls++
	f.accountID = accountID
	f.patch = patch
	f.defaultPrompt = defaultPrompt
	return f.patchResult, f.patchErr
}

type emailDraftRecordingPublisher struct {
	resources []resourceevents.Resource
	err       error
}

func (p *emailDraftRecordingPublisher) PublishChanged(_ context.Context, _ string, resource resourceevents.Resource, _ *string) error {
	p.resources = append(p.resources, resource)
	return p.err
}

func emailDraftTestContext(method, body, accountID string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, "/api/email-draft-settings", strings.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")
	if accountID != "" {
		context.Set("authPrincipal", &auth.Principal{User: &models.User{ID: accountID}})
	}
	return context, recorder
}

func TestEmailDraftSettingsGetReturnsDefaultsWithoutWritingOrPublishing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &fakeEmailDraftSettingsRepository{getErr: repository.ErrEmailDraftSettingsNotFound}
	publisher := &emailDraftRecordingPublisher{}
	handler := NewEmailDraftSettingsHandler(repo, publisher)
	context, recorder := emailDraftTestContext(http.MethodGet, "", uuid.NewString())

	handler.Get(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("get returned %d: %s", recorder.Code, recorder.Body.String())
	}
	if repo.getCalls != 1 || repo.patchCalls != 0 || len(publisher.resources) != 0 {
		t.Fatalf("unexpected side effects: get=%d patch=%d resources=%v", repo.getCalls, repo.patchCalls, publisher.resources)
	}
	if !strings.Contains(recorder.Body.String(), `"enabled":true`) ||
		!strings.Contains(recorder.Body.String(), `"include_sharing_link":true`) ||
		!strings.Contains(recorder.Body.String(), `"created_at":null`) ||
		!strings.Contains(recorder.Body.String(), "Be concise") {
		t.Fatalf("default response is incomplete: %s", recorder.Body.String())
	}
}

func TestEmailDraftSettingsPatchPreservesFalseAndEmptyValuesAndPublishes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	accountID := uuid.NewString()
	settings := &repository.EmailDraftSettings{Enabled: false, IncludeSharingLink: true, DraftPrompt: ""}
	repo := &fakeEmailDraftSettingsRepository{patchResult: settings}
	publisher := &emailDraftRecordingPublisher{}
	handler := NewEmailDraftSettingsHandler(repo, publisher)
	context, recorder := emailDraftTestContext(http.MethodPatch, `{"enabled":false,"draft_prompt":""}`, accountID)

	handler.Patch(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("patch returned %d: %s", recorder.Code, recorder.Body.String())
	}
	if repo.patchCalls != 1 || repo.accountID != accountID {
		t.Fatalf("patch used wrong account: calls=%d account=%q", repo.patchCalls, repo.accountID)
	}
	if repo.patch.Enabled == nil || *repo.patch.Enabled || repo.patch.DraftPrompt == nil || *repo.patch.DraftPrompt != "" {
		t.Fatalf("false or empty patch values were lost: %+v", repo.patch)
	}
	if repo.patch.IncludeSharingLink != nil || repo.defaultPrompt != defaultEmailDraftPrompt {
		t.Fatalf("unexpected patch/default: %+v default=%q", repo.patch, repo.defaultPrompt)
	}
	if len(publisher.resources) != 1 || publisher.resources[0] != resourceevents.ResourceEmailDraftSettings {
		t.Fatalf("unexpected published resources: %v", publisher.resources)
	}
}

func TestEmailDraftSettingsPatchValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{name: "empty", body: `{}`, wantStatus: http.StatusUnprocessableEntity, wantCode: "email_draft_settings_empty_update"},
		{name: "unknown", body: `{"other":true}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request_payload"},
		{name: "too long unicode", body: `{"draft_prompt":"` + strings.Repeat("界", maxEmailDraftPromptLength+1) + `"}`, wantStatus: http.StatusUnprocessableEntity, wantCode: "email_draft_prompt_too_long"},
		{name: "multiple values", body: `{"enabled":true}{"enabled":false}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request_payload"},
		{name: "malformed", body: `{"enabled":`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request_payload"},
		{name: "oversized", body: `{"draft_prompt":"` + strings.Repeat("a", maxEmailDraftSettingsRequestBytes) + `"}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request_payload"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repo := &fakeEmailDraftSettingsRepository{}
			publisher := &emailDraftRecordingPublisher{}
			handler := NewEmailDraftSettingsHandler(repo, publisher)
			context, recorder := emailDraftTestContext(http.MethodPatch, test.body, uuid.NewString())
			handler.Patch(context)
			if recorder.Code != test.wantStatus || !strings.Contains(recorder.Body.String(), `"code":"`+test.wantCode+`"`) {
				t.Fatalf("got %d %s, want %d %s", recorder.Code, recorder.Body.String(), test.wantStatus, test.wantCode)
			}
			if repo.patchCalls != 0 || len(publisher.resources) != 0 {
				t.Fatalf("invalid request caused side effects: patch=%d resources=%v", repo.patchCalls, publisher.resources)
			}
		})
	}
}

func TestEmailDraftSettingsPatchAcceptsOneThousandUnicodeCharacters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	prompt := strings.Repeat("界", maxEmailDraftPromptLength)
	repo := &fakeEmailDraftSettingsRepository{patchResult: &repository.EmailDraftSettings{Enabled: true, IncludeSharingLink: true, DraftPrompt: prompt}}
	handler := NewEmailDraftSettingsHandler(repo, &emailDraftRecordingPublisher{})
	context, recorder := emailDraftTestContext(http.MethodPatch, `{"draft_prompt":"`+prompt+`"}`, uuid.NewString())
	handler.Patch(context)
	if recorder.Code != http.StatusOK || repo.patchCalls != 1 {
		t.Fatalf("valid Unicode prompt rejected: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestEmailDraftSettingsPatchDoesNotPublishOnRepositoryFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &fakeEmailDraftSettingsRepository{patchErr: errors.New("database unavailable")}
	publisher := &emailDraftRecordingPublisher{}
	handler := NewEmailDraftSettingsHandler(repo, publisher)
	context, recorder := emailDraftTestContext(http.MethodPatch, `{"enabled":false}`, uuid.NewString())
	handler.Patch(context)
	if recorder.Code != http.StatusInternalServerError || len(publisher.resources) != 0 {
		t.Fatalf("status=%d resources=%v", recorder.Code, publisher.resources)
	}
}

func TestEmailDraftSettingsPatchIgnoresPublisherFailureAfterCommit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &fakeEmailDraftSettingsRepository{patchResult: &repository.EmailDraftSettings{Enabled: false, IncludeSharingLink: true, DraftPrompt: "Prompt"}}
	publisher := &emailDraftRecordingPublisher{err: errors.New("redis unavailable")}
	handler := NewEmailDraftSettingsHandler(repo, publisher)
	context, recorder := emailDraftTestContext(http.MethodPatch, `{"enabled":false}`, uuid.NewString())
	handler.Patch(context)
	if recorder.Code != http.StatusOK || len(publisher.resources) != 1 {
		t.Fatalf("status=%d resources=%v", recorder.Code, publisher.resources)
	}
}
