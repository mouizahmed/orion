package auth

import (
	"errors"
	"fmt"

	firebaseauth "firebase.google.com/go/v4/auth"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type PrincipalErrorCode string

const (
	PrincipalTokenExpired       PrincipalErrorCode = "auth_token_expired"
	PrincipalTokenRevoked       PrincipalErrorCode = "auth_token_revoked"
	PrincipalFirebaseDisabled   PrincipalErrorCode = "auth_firebase_user_disabled"
	PrincipalFirebaseMissing    PrincipalErrorCode = "auth_firebase_user_missing"
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

func (e *PrincipalError) Unwrap() error {
	return e.Cause
}

type Principal struct {
	FirebaseUID string
	User        *models.User
}

func (p *Principal) UserID() string {
	if p == nil || p.User == nil {
		return ""
	}
	return p.User.ID
}

type PrincipalTokenVerifier interface {
	VerifyIDTokenAndCheckRevoked(idToken string) (*firebaseauth.Token, error)
}

type PrincipalUserStore interface {
	GetUserByIDForAuthentication(id string) (*models.User, error)
}

type PrincipalService struct {
	verifier PrincipalTokenVerifier
	users    PrincipalUserStore
}

func NewPrincipalService(verifier PrincipalTokenVerifier, users PrincipalUserStore) *PrincipalService {
	return &PrincipalService{verifier: verifier, users: users}
}

func (s *PrincipalService) Resolve(idToken string) (*Principal, error) {
	if s == nil || s.verifier == nil || s.users == nil {
		return nil, principalError(
			PrincipalServiceUnavailable,
			"Authentication service is unavailable.",
			nil,
		)
	}

	verifiedToken, err := s.verifier.VerifyIDTokenAndCheckRevoked(idToken)
	if err != nil {
		return nil, mapFirebaseTokenError(err)
	}
	if verifiedToken == nil || verifiedToken.UID == "" {
		return nil, principalError(
			PrincipalTokenInvalid,
			"Authentication token is invalid.",
			nil,
		)
	}

	user, err := s.users.GetUserByIDForAuthentication(verifiedToken.UID)
	if err != nil {
		return nil, principalError(
			PrincipalServiceUnavailable,
			"Authentication service is unavailable.",
			fmt.Errorf("load application user: %w", err),
		)
	}
	if user == nil {
		return nil, principalError(
			PrincipalUserMissing,
			"Your application account no longer exists.",
			nil,
		)
	}

	switch {
	case user.DeletedAt != nil || user.Status == models.UserStatusDeleted:
		return nil, principalError(
			PrincipalUserDeleted,
			"Your account has been deleted.",
			nil,
		)
	case user.Status == models.UserStatusSuspended:
		return nil, principalError(
			PrincipalUserSuspended,
			"Your account has been suspended.",
			nil,
		)
	case user.Status != models.UserStatusActive:
		return nil, principalError(
			PrincipalUserInactive,
			"Your account is not active.",
			nil,
		)
	}

	return &Principal{FirebaseUID: verifiedToken.UID, User: user}, nil
}

func principalError(code PrincipalErrorCode, message string, cause error) *PrincipalError {
	return &PrincipalError{Code: code, Message: message, Cause: cause}
}

func mapFirebaseTokenError(err error) *PrincipalError {
	var tokenErr *FirebaseTokenError
	if !errors.As(err, &tokenErr) {
		return principalError(PrincipalTokenInvalid, "Authentication token is invalid.", err)
	}

	switch tokenErr.Code {
	case FirebaseTokenExpired:
		return principalError(PrincipalTokenExpired, "Your session has expired.", err)
	case FirebaseTokenRevoked:
		return principalError(PrincipalTokenRevoked, "Your session has been revoked.", err)
	case FirebaseUserDisabled:
		return principalError(PrincipalFirebaseDisabled, "Your sign-in account has been disabled.", err)
	case FirebaseUserMissing:
		return principalError(PrincipalFirebaseMissing, "Your sign-in account no longer exists.", err)
	case FirebaseVerifierFailure:
		return principalError(PrincipalServiceUnavailable, "Authentication service is unavailable.", err)
	default:
		return principalError(PrincipalTokenInvalid, "Authentication token is invalid.", err)
	}
}
