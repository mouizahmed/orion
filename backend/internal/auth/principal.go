package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type PrincipalErrorCode string

const (
	PrincipalTokenExpired       PrincipalErrorCode = "auth_token_expired"
	PrincipalTokenRevoked       PrincipalErrorCode = "auth_token_revoked"
	PrincipalIdentityDisabled   PrincipalErrorCode = "auth_identity_disabled"
	PrincipalIdentityMissing    PrincipalErrorCode = "auth_identity_missing"
	PrincipalTokenInvalid       PrincipalErrorCode = "auth_token_invalid"
	PrincipalUserMissing        PrincipalErrorCode = "auth_user_missing"
	PrincipalUserSuspended      PrincipalErrorCode = "auth_user_suspended"
	PrincipalUserDeleted        PrincipalErrorCode = "auth_user_deleted"
	PrincipalUserInactive       PrincipalErrorCode = "auth_user_inactive"
	PrincipalServiceUnavailable PrincipalErrorCode = "auth_service_unavailable"
)

type PrincipalError struct {
	Code    PrincipalErrorCode
	Message string
	Cause   error
}

func (e *PrincipalError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return string(e.Code)
}
func (e *PrincipalError) Unwrap() error { return e.Cause }

type Principal struct {
	AuthUserID string
	User       *models.User
}

func (p *Principal) UserID() string {
	if p == nil || p.User == nil {
		return ""
	}
	return p.User.ID
}

type PrincipalTokenVerifier interface {
	ValidateAccessToken(context.Context, string) (*SupabaseUser, error)
}

type PrincipalUserStore interface {
	IsAuthSessionActive(context.Context, string, string) (bool, error)
	GetUserByIDForAuthentication(string) (*models.User, error)
	EnsureUserFromAuth(context.Context, *SupabaseUser) (*models.User, bool, error)
}

type PrincipalService struct {
	verifier PrincipalTokenVerifier
	users    PrincipalUserStore
}

func NewPrincipalService(verifier PrincipalTokenVerifier, users PrincipalUserStore) *PrincipalService {
	return &PrincipalService{verifier: verifier, users: users}
}

func (s *PrincipalService) Resolve(ctx context.Context, accessToken string) (*Principal, error) {
	authUser, err := s.validate(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	user, err := s.users.GetUserByIDForAuthentication(authUser.ID)
	if err != nil {
		return nil, principalError(PrincipalServiceUnavailable, "Authentication service is unavailable.", fmt.Errorf("load application user: %w", err))
	}
	if user == nil {
		return nil, principalError(PrincipalUserMissing, "Your application account does not exist.", nil)
	}
	return activePrincipal(authUser.ID, user)
}

func (s *PrincipalService) Bootstrap(ctx context.Context, accessToken string) (*Principal, bool, error) {
	authUser, err := s.validate(ctx, accessToken)
	if err != nil {
		return nil, false, err
	}
	user, created, err := s.users.EnsureUserFromAuth(ctx, authUser)
	if err != nil {
		return nil, false, principalError(PrincipalServiceUnavailable, "Authentication service is unavailable.", fmt.Errorf("provision application user: %w", err))
	}
	principal, err := activePrincipal(authUser.ID, user)
	return principal, created, err
}

func (s *PrincipalService) validate(ctx context.Context, accessToken string) (*SupabaseUser, error) {
	if s == nil || s.verifier == nil || s.users == nil {
		return nil, principalError(PrincipalServiceUnavailable, "Authentication service is unavailable.", nil)
	}
	authUser, err := s.verifier.ValidateAccessToken(ctx, accessToken)
	if err != nil {
		return nil, mapSessionError(err)
	}
	if authUser == nil || strings.TrimSpace(authUser.ID) == "" {
		return nil, principalError(PrincipalTokenInvalid, "Authentication token is invalid.", nil)
	}
	active, err := s.users.IsAuthSessionActive(ctx, authUser.ID, authUser.SessionID)
	if err != nil {
		return nil, principalError(PrincipalServiceUnavailable, "Authentication service is unavailable.", fmt.Errorf("validate managed Auth session: %w", err))
	}
	if !active {
		return nil, principalError(PrincipalTokenRevoked, "Your session has been revoked.", nil)
	}
	return authUser, nil
}

func activePrincipal(authUserID string, user *models.User) (*Principal, error) {
	if user == nil {
		return nil, principalError(PrincipalUserMissing, "Your application account does not exist.", nil)
	}
	switch {
	case user.DeletedAt != nil || user.Status == models.UserStatusDeleted:
		return nil, principalError(PrincipalUserDeleted, "Your account has been deleted.", nil)
	case user.Status == models.UserStatusSuspended:
		return nil, principalError(PrincipalUserSuspended, "Your account has been suspended.", nil)
	case user.Status != models.UserStatusActive:
		return nil, principalError(PrincipalUserInactive, "Your account is not active.", nil)
	}
	return &Principal{AuthUserID: authUserID, User: user}, nil
}

func principalError(code PrincipalErrorCode, message string, cause error) *PrincipalError {
	return &PrincipalError{Code: code, Message: message, Cause: cause}
}

func mapSessionError(err error) *PrincipalError {
	var sessionErr *SessionError
	if !errors.As(err, &sessionErr) {
		return principalError(PrincipalTokenInvalid, "Authentication token is invalid.", err)
	}
	switch sessionErr.Code {
	case SessionExpired:
		return principalError(PrincipalTokenExpired, "Your session has expired.", err)
	case SessionRevoked:
		return principalError(PrincipalTokenRevoked, "Your session has been revoked.", err)
	case SessionIdentityDisabled:
		return principalError(PrincipalIdentityDisabled, "Your sign-in identity is disabled.", err)
	case SessionUserMissing:
		return principalError(PrincipalIdentityMissing, "Your sign-in identity no longer exists.", err)
	case SessionUpstreamFailure:
		return principalError(PrincipalServiceUnavailable, "Authentication service is unavailable.", err)
	default:
		return principalError(PrincipalTokenInvalid, "Authentication token is invalid.", err)
	}
}

func StatusForPrincipalError(err error) int {
	var principalErr *PrincipalError
	if !errors.As(err, &principalErr) {
		return 503
	}
	switch principalErr.Code {
	case PrincipalUserSuspended, PrincipalUserDeleted, PrincipalUserInactive:
		return 403
	case PrincipalServiceUnavailable:
		return 503
	default:
		return 401
	}
}
