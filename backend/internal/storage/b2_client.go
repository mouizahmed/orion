package storage

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type B2Client struct {
	bucketName  string
	bucketID    string
	apiURL      string
	downloadURL string
	authToken   string
	httpClient  *http.Client
}

// B2 Native API structures
type B2AuthorizeResponse struct {
	AuthorizationToken string `json:"authorizationToken"`
	APIURL             string `json:"apiUrl"`
	AccountID          string `json:"accountId"`
	DownloadURL        string `json:"downloadUrl"`
}

type B2StartLargeFileRequest struct {
	BucketID    string            `json:"bucketId"`
	FileName    string            `json:"fileName"`
	ContentType string            `json:"contentType"`
	FileInfo    map[string]string `json:"fileInfo,omitempty"`
}

type B2StartLargeFileResponse struct {
	FileID string `json:"fileId"`
}

type B2GetUploadPartURLRequest struct {
	FileID string `json:"fileId"`
}

type B2GetUploadPartURLResponse struct {
	FileID             string `json:"fileId"`
	UploadURL          string `json:"uploadUrl"`
	AuthorizationToken string `json:"authorizationToken"`
}

type B2FinishLargeFileRequest struct {
	FileID        string   `json:"fileId"`
	PartSha1Array []string `json:"partSha1Array"`
}

type B2FinishLargeFileResponse struct {
	FileID   string `json:"fileId"`
	FileName string `json:"fileName"`
	FileSize int64  `json:"contentLength"`
}

type B2CancelLargeFileRequest struct {
	FileID string `json:"fileId"`
}

type B2CancelLargeFileResponse struct {
	FileID    string `json:"fileId"`
	AccountID string `json:"accountId"`
	BucketID  string `json:"bucketId"`
	FileName  string `json:"fileName"`
}

func NewB2Client() (*B2Client, error) {
	b2Client := &B2Client{
		bucketName: os.Getenv("B2_BUCKET_NAME"),
		bucketID:   os.Getenv("B2_BUCKET_ID"),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}

	// Authorize with B2 Native API
	err := b2Client.authorizeB2()
	if err != nil {
		return nil, fmt.Errorf("failed to authorize with B2: %w", err)
	}

	return b2Client, nil
}

func (b *B2Client) GetBucketName() string {
	return b.bucketName
}

const (
	MinPartSize = 5 * 1024 * 1024 // 5MB minimum for B2 large file parts
)

// B2 Native API authorization
func (b *B2Client) authorizeB2() error {
	keyID := os.Getenv("B2_ACCESS_KEY_ID")
	appKey := os.Getenv("B2_SECRET_ACCESS_KEY")

	req, err := http.NewRequest("GET", "https://api.backblazeb2.com/b2api/v2/b2_authorize_account", nil)
	if err != nil {
		return err
	}

	req.SetBasicAuth(keyID, appKey)

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("B2 authorization failed with status %d", resp.StatusCode)
	}

	var authResp B2AuthorizeResponse
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return err
	}

	b.authToken = authResp.AuthorizationToken
	b.apiURL = authResp.APIURL
	b.downloadURL = authResp.DownloadURL

	return nil
}

// Start large file upload
func (b *B2Client) StartLargeFile(fileName, contentType string) (*B2StartLargeFileResponse, error) {
	reqBody := B2StartLargeFileRequest{
		BucketID:    b.bucketID,
		FileName:    fileName,
		ContentType: contentType,
	}

	jsonBody, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", b.apiURL+"/b2api/v2/b2_start_large_file", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", b.authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("start large file failed: %s", string(body))
	}

	var startResp B2StartLargeFileResponse
	if err := json.NewDecoder(resp.Body).Decode(&startResp); err != nil {
		return nil, err
	}

	return &startResp, nil
}

// Get upload part URL
func (b *B2Client) GetUploadPartURL(fileID string) (*B2GetUploadPartURLResponse, error) {
	reqBody := B2GetUploadPartURLRequest{FileID: fileID}
	jsonBody, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", b.apiURL+"/b2api/v2/b2_get_upload_part_url", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", b.authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get upload part URL failed: %s", string(body))
	}

	var urlResp B2GetUploadPartURLResponse
	if err := json.NewDecoder(resp.Body).Decode(&urlResp); err != nil {
		return nil, err
	}

	return &urlResp, nil
}

// Upload part to B2
func (b *B2Client) UploadPart(uploadURL, authToken string, partNumber int, data []byte) (string, error) {
	// Calculate SHA1 hash
	hash := sha1.Sum(data)
	sha1Hash := hex.EncodeToString(hash[:])

	req, err := http.NewRequest("POST", uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", err
	}

	req.Header.Set("Authorization", authToken)
	req.Header.Set("X-Bz-Part-Number", fmt.Sprintf("%d", partNumber))
	req.Header.Set("X-Bz-Content-Sha1", sha1Hash)
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(data)))

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("upload part failed: %s", string(body))
	}

	return sha1Hash, nil
}

// Finish large file upload
func (b *B2Client) FinishLargeFile(fileID string, partSha1Array []string) (*B2FinishLargeFileResponse, error) {
	reqBody := B2FinishLargeFileRequest{
		FileID:        fileID,
		PartSha1Array: partSha1Array,
	}

	jsonBody, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", b.apiURL+"/b2api/v2/b2_finish_large_file", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", b.authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("finish large file failed: %s", string(body))
	}

	var finishResp B2FinishLargeFileResponse
	if err := json.NewDecoder(resp.Body).Decode(&finishResp); err != nil {
		return nil, err
	}

	return &finishResp, nil
}

// Cancel large file upload and delete all uploaded parts
func (b *B2Client) CancelLargeFile(fileID string) (*B2CancelLargeFileResponse, error) {
	reqBody := B2CancelLargeFileRequest{
		FileID: fileID,
	}

	jsonBody, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", b.apiURL+"/b2api/v2/b2_cancel_large_file", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", b.authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("cancel large file failed: %s", string(body))
	}

	var cancelResp B2CancelLargeFileResponse
	if err := json.NewDecoder(resp.Body).Decode(&cancelResp); err != nil {
		return nil, err
	}

	return &cancelResp, nil
}

// Simple upload for small files using B2 Native API
type B2GetUploadURLRequest struct {
	BucketID string `json:"bucketId"`
}

type B2GetUploadURLResponse struct {
	BucketID           string `json:"bucketId"`
	UploadURL          string `json:"uploadUrl"`
	AuthorizationToken string `json:"authorizationToken"`
}

type B2UploadFileResponse struct {
	FileID      string `json:"fileId"`
	FileName    string `json:"fileName"`
	FileSize    int64  `json:"contentLength"`
	BucketID    string `json:"bucketId"`
	AccountID   string `json:"accountId"`
	ContentSHA1 string `json:"contentSha1"`
}

// Get upload URL for simple file upload
func (b *B2Client) GetUploadURL() (*B2GetUploadURLResponse, error) {
	reqBody := B2GetUploadURLRequest{BucketID: b.bucketID}
	jsonBody, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", b.apiURL+"/b2api/v2/b2_get_upload_url", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", b.authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get upload URL failed: %s", string(body))
	}

	var uploadResp B2GetUploadURLResponse
	if err := json.NewDecoder(resp.Body).Decode(&uploadResp); err != nil {
		return nil, err
	}

	return &uploadResp, nil
}

// Upload file using simple upload
func (b *B2Client) UploadFile(uploadURL, authToken, fileName, contentType string, data []byte) (*B2UploadFileResponse, error) {
	// Calculate SHA1 hash
	hash := sha1.Sum(data)
	sha1Hash := hex.EncodeToString(hash[:])

	req, err := http.NewRequest("POST", uploadURL, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", authToken)
	req.Header.Set("X-Bz-File-Name", fileName)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Bz-Content-Sha1", sha1Hash)
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(data)))

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("upload file failed: %s", string(body))
	}

	var uploadResp B2UploadFileResponse
	if err := json.NewDecoder(resp.Body).Decode(&uploadResp); err != nil {
		return nil, err
	}

	return &uploadResp, nil
}

func (b *B2Client) BucketID() string {
	return b.bucketID
}

func (b *B2Client) BucketName() string {
	return b.bucketName
}

// Delete file from B2
func (b *B2Client) DeleteFile(fileName string) error {
	// First, get file info to get the file ID
	req, err := http.NewRequest("POST", fmt.Sprintf("%s/b2api/v2/b2_list_file_names", b.apiURL),
		strings.NewReader(fmt.Sprintf(`{"bucketId":"%s","startFileName":"%s","maxFileCount":1}`, b.bucketID, fileName)))
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", b.authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to list file: %s", string(body))
	}

	var listResp struct {
		Files []struct {
			FileID   string `json:"fileId"`
			FileName string `json:"fileName"`
		} `json:"files"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		return err
	}

	if len(listResp.Files) == 0 {
		return fmt.Errorf("file not found: %s", fileName)
	}

	fileID := listResp.Files[0].FileID

	// Now delete the file using the file ID
	deleteReq, err := http.NewRequest("POST", fmt.Sprintf("%s/b2api/v2/b2_delete_file_version", b.apiURL),
		strings.NewReader(fmt.Sprintf(`{"fileId":"%s","fileName":"%s"}`, fileID, fileName)))
	if err != nil {
		return err
	}

	deleteReq.Header.Set("Authorization", b.authToken)
	deleteReq.Header.Set("Content-Type", "application/json")

	deleteResp, err := b.httpClient.Do(deleteReq)
	if err != nil {
		return err
	}
	defer deleteResp.Body.Close()

	if deleteResp.StatusCode != 200 {
		body, _ := io.ReadAll(deleteResp.Body)
		return fmt.Errorf("failed to delete file: %s", string(body))
	}

	return nil
}

type B2GetDownloadAuthRequest struct {
	BucketID               string `json:"bucketId"`
	FileNamePrefix         string `json:"fileNamePrefix"`
	ValidDurationInSeconds int    `json:"validDurationInSeconds"`
}

type B2GetDownloadAuthResponse struct {
	AuthorizationToken string `json:"authorizationToken"`
}

// GetSignedDownloadURL returns a time-limited signed URL for a private B2 file.
// The client is redirected to this URL directly, so image bytes flow from B2's CDN
// to the client without passing through this server.
func (b *B2Client) GetSignedDownloadURL(b2FileName string, validSeconds int) (string, error) {
	reqBody := B2GetDownloadAuthRequest{
		BucketID:               b.bucketID,
		FileNamePrefix:         b2FileName,
		ValidDurationInSeconds: validSeconds,
	}
	jsonBody, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", b.apiURL+"/b2api/v2/b2_get_download_authorization", bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", b.authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("b2_get_download_authorization failed (%d): %s", resp.StatusCode, string(body))
	}

	var authResp B2GetDownloadAuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return "", err
	}

	// Build signed URL: each path segment is individually percent-encoded
	segments := strings.Split(b2FileName, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	encodedFileName := strings.Join(segments, "/")

	signedURL := fmt.Sprintf("%s/file/%s/%s?Authorization=%s",
		b.downloadURL,
		url.PathEscape(b.bucketName),
		encodedFileName,
		url.QueryEscape(authResp.AuthorizationToken),
	)
	return signedURL, nil
}

// Get file URL with proper URL encoding for special characters
func (b *B2Client) GetFileURL(fileName string) string {
	// URL encode the entire path to handle special characters, spaces, and emojis
	encodedFileName := url.QueryEscape(fileName)
	return fmt.Sprintf("https://f005.backblazeb2.com/file/%s/%s", b.bucketName, encodedFileName)
}
