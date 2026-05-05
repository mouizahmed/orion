package profile

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/storage"
)

const MaxAvatarBytes = 4 << 20

type AvatarService struct {
	b2Client *storage.B2Client
}

func NewAvatarService(b2Client *storage.B2Client) *AvatarService {
	return &AvatarService{b2Client: b2Client}
}

func (s *AvatarService) UploadUserAvatar(userID string, data []byte, mimeType string) (string, error) {
	if s == nil || s.b2Client == nil {
		return "", fmt.Errorf("avatar storage is not configured")
	}
	if userID == "" {
		return "", fmt.Errorf("user id is required")
	}
	if len(data) == 0 {
		return "", fmt.Errorf("avatar data is required")
	}
	if len(data) > MaxAvatarBytes {
		return "", fmt.Errorf("avatar exceeds maximum size of %d bytes", MaxAvatarBytes)
	}

	extension, ok := AvatarExtension(mimeType)
	if !ok {
		return "", fmt.Errorf("unsupported avatar type: %s", mimeType)
	}

	fileName := fmt.Sprintf("avatars/%s/%s%s", userID, uuid.NewString(), extension)
	uploadURLResp, err := s.b2Client.GetUploadURL()
	if err != nil {
		return "", fmt.Errorf("failed to get avatar upload URL: %w", err)
	}

	uploadResp, err := s.b2Client.UploadFile(
		uploadURLResp.UploadURL,
		uploadURLResp.AuthorizationToken,
		fileName,
		mimeType,
		data,
	)
	if err != nil {
		return "", fmt.Errorf("failed to upload avatar: %w", err)
	}

	return s.b2Client.GetFileURL(uploadResp.FileName), nil
}

func IsSupportedAvatarMimeType(mimeType string) bool {
	_, ok := AvatarExtension(mimeType)
	return ok
}

func AvatarExtension(mimeType string) (string, bool) {
	switch mimeType {
	case "image/jpeg":
		return ".jpg", true
	case "image/png":
		return ".png", true
	case "image/gif":
		return ".gif", true
	case "image/webp":
		return ".webp", true
	default:
		return "", false
	}
}
