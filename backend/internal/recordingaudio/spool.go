package recordingaudio

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

const (
	spoolDirectoryEnv = "RECORDING_AUDIO_SPOOL_DIR"
	recordMagic       = "ORSP"
	recordVersion     = byte(1)
	recordHeaderBytes = 24
	maxFrameBytes     = 1 << 20
	maxTrackBytes     = int64(4 << 30)
	syncInterval      = time.Second
)

type Mode string

const (
	ModeNone   Mode = "none"
	ModeLocal  Mode = "local"
	ModeServer Mode = "server"
)

type Source byte

const (
	SourceMicrophone Source = iota
	SourceSystem
)

type Config struct{ RootDirectory string }

type Artifacts struct {
	Exists         bool
	Directory      string
	MicrophonePath string
	SystemPath     string
}

type Store struct {
	root     string
	mu       sync.Mutex
	sessions map[string]*session
}

type session struct {
	directory string
	mu        sync.Mutex
	tracks    [2]*track
}

type track struct {
	file         *os.File
	bytesWritten int64
	nextSequence uint64
	lastSync     time.Time
}

func LoadConfig() Config {
	root := strings.TrimSpace(os.Getenv(spoolDirectoryEnv))
	if root == "" {
		root = filepath.Join(os.TempDir(), "orion-recording-audio")
	}
	return Config{RootDirectory: root}
}

func NewStore(config Config) (*Store, error) {
	root, err := filepath.Abs(strings.TrimSpace(config.RootDirectory))
	if err != nil {
		return nil, fmt.Errorf("resolve recording audio spool directory: %w", err)
	}
	if root == filepath.VolumeName(root)+string(filepath.Separator) {
		return nil, errors.New("recording audio spool directory cannot be a filesystem root")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create recording audio spool directory: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return nil, fmt.Errorf("protect recording audio spool directory: %w", err)
	}
	return &Store{root: root, sessions: make(map[string]*session)}, nil
}

func ParseMode(value string) (Mode, error) {
	mode := Mode(strings.TrimSpace(value))
	switch mode {
	case ModeNone, ModeLocal, ModeServer:
		return mode, nil
	default:
		return "", fmt.Errorf("unsupported audio storage mode %q", value)
	}
}

func (s *Store) Open(userID, sessionID string) error {
	key, directory, err := s.sessionPath(userID, sessionID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.sessions[key]; ok {
		return nil
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create recording audio session spool: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("protect recording audio session spool: %w", err)
	}
	s.sessions[key] = &session{directory: directory}
	return nil
}

func (s *Store) Append(userID, sessionID string, source Source, sequence uint64, pcm []byte) error {
	key, _, err := s.sessionPath(userID, sessionID)
	if err != nil {
		return err
	}
	if source != SourceMicrophone && source != SourceSystem {
		return errors.New("recording audio source is invalid")
	}
	if len(pcm) == 0 || len(pcm) > maxFrameBytes || len(pcm)%2 != 0 {
		return errors.New("recording audio frame is invalid")
	}
	s.mu.Lock()
	current := s.sessions[key]
	s.mu.Unlock()
	if current == nil {
		return errors.New("recording audio session spool is not open")
	}
	return current.append(source, sequence, pcm)
}

func (s *Store) Seal(userID, sessionID string) (Artifacts, error) {
	key, directory, err := s.sessionPath(userID, sessionID)
	if err != nil {
		return Artifacts{}, err
	}
	s.mu.Lock()
	current := s.sessions[key]
	delete(s.sessions, key)
	s.mu.Unlock()
	if current != nil {
		if err := current.close(); err != nil {
			return Artifacts{}, err
		}
	}
	_, statErr := os.Stat(directory)
	if statErr != nil && !os.IsNotExist(statErr) {
		return Artifacts{}, fmt.Errorf("inspect recording audio session spool: %w", statErr)
	}
	return Artifacts{
		Exists:         statErr == nil,
		Directory:      directory,
		MicrophonePath: filepath.Join(directory, "microphone.pcmspool"),
		SystemPath:     filepath.Join(directory, "system.pcmspool"),
	}, nil
}

func (s *Store) Cleanup(userID, sessionID string) error {
	artifacts, err := s.Seal(userID, sessionID)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(artifacts.Directory); err != nil {
		return fmt.Errorf("remove recording audio session spool: %w", err)
	}
	return nil
}

// ListSessions returns only canonical UUID directory pairs created by this
// store. Unknown filesystem entries are never treated as recording spools.
func (s *Store) ListSessions() ([]models.RecordingSessionIdentity, error) {
	userEntries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, fmt.Errorf("list recording audio spool users: %w", err)
	}
	identities := make([]models.RecordingSessionIdentity, 0)
	for _, userEntry := range userEntries {
		userID, ok := canonicalDirectoryUUID(userEntry)
		if !ok {
			continue
		}
		sessionEntries, err := os.ReadDir(filepath.Join(s.root, userID))
		if err != nil {
			return nil, fmt.Errorf("list recording audio user spools: %w", err)
		}
		for _, sessionEntry := range sessionEntries {
			sessionID, ok := canonicalDirectoryUUID(sessionEntry)
			if !ok {
				continue
			}
			identities = append(identities, models.RecordingSessionIdentity{
				ID:     sessionID,
				UserID: userID,
			})
		}
	}
	return identities, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	sessions := s.sessions
	s.sessions = make(map[string]*session)
	s.mu.Unlock()
	var closeErr error
	for _, current := range sessions {
		closeErr = errors.Join(closeErr, current.close())
	}
	return closeErr
}

func (s *Store) sessionPath(userID, sessionID string) (string, string, error) {
	userUUID, err := uuid.Parse(strings.TrimSpace(userID))
	if err != nil {
		return "", "", errors.New("recording audio user ID is invalid")
	}
	sessionUUID, err := uuid.Parse(strings.TrimSpace(sessionID))
	if err != nil {
		return "", "", errors.New("recording audio session ID is invalid")
	}
	key := userUUID.String() + "/" + sessionUUID.String()
	return key, filepath.Join(s.root, userUUID.String(), sessionUUID.String()), nil
}

func canonicalDirectoryUUID(entry os.DirEntry) (string, bool) {
	if !entry.IsDir() {
		return "", false
	}
	parsed, err := uuid.Parse(entry.Name())
	if err != nil || parsed.String() != entry.Name() {
		return "", false
	}
	return parsed.String(), true
}

func (s *session) append(source Source, sequence uint64, pcm []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.tracks[int(source)]
	if current == nil {
		opened, err := openTrack(filepath.Join(s.directory, source.filename()), source)
		if err != nil {
			return err
		}
		current = opened
		s.tracks[int(source)] = current
	}
	if sequence < current.nextSequence {
		return nil
	}
	if sequence != current.nextSequence {
		return fmt.Errorf("recording audio sequence gap: got %d, expected %d", sequence, current.nextSequence)
	}
	recordBytes := int64(recordHeaderBytes + len(pcm))
	if current.bytesWritten+recordBytes > maxTrackBytes {
		return errors.New("recording audio track spool limit exceeded")
	}
	header := make([]byte, recordHeaderBytes)
	copy(header[0:4], recordMagic)
	header[4] = recordVersion
	header[5] = byte(source)
	binary.LittleEndian.PutUint64(header[8:16], sequence)
	binary.LittleEndian.PutUint32(header[16:20], uint32(len(pcm)))
	binary.LittleEndian.PutUint32(header[20:24], crc32.ChecksumIEEE(pcm))
	start := current.bytesWritten
	if _, err := current.file.Write(header); err != nil {
		return current.rollback(start, err)
	}
	if _, err := current.file.Write(pcm); err != nil {
		return current.rollback(start, err)
	}
	current.bytesWritten += recordBytes
	current.nextSequence++
	if time.Since(current.lastSync) >= syncInterval {
		if err := current.file.Sync(); err != nil {
			return fmt.Errorf("sync recording audio spool: %w", err)
		}
		current.lastSync = time.Now()
	}
	return nil
}

func (s *session) close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var closeErr error
	for index, current := range s.tracks {
		if current == nil {
			continue
		}
		closeErr = errors.Join(closeErr, current.file.Sync(), current.file.Close())
		s.tracks[index] = nil
	}
	if closeErr != nil {
		return fmt.Errorf("close recording audio spool: %w", closeErr)
	}
	return nil
}

func openTrack(path string, source Source) (*track, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open recording audio track spool: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("protect recording audio track spool: %w", err)
	}
	current := &track{file: file}
	if err := current.scan(source); err != nil {
		_ = file.Close()
		return nil, err
	}
	return current, nil
}

func (t *track) scan(source Source) error {
	if _, err := t.file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("seek recording audio spool: %w", err)
	}
	header := make([]byte, recordHeaderBytes)
	var validBytes int64
	var expectedSequence uint64
	for {
		_, err := io.ReadFull(t.file, header)
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read recording audio spool header: %w", err)
		}
		length := int(binary.LittleEndian.Uint32(header[16:20]))
		sequence := binary.LittleEndian.Uint64(header[8:16])
		if string(header[0:4]) != recordMagic || header[4] != recordVersion || header[5] != byte(source) || length <= 0 || length > maxFrameBytes || length%2 != 0 || sequence != expectedSequence {
			break
		}
		payload := make([]byte, length)
		if _, err := io.ReadFull(t.file, payload); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				break
			}
			return fmt.Errorf("read recording audio spool payload: %w", err)
		}
		if crc32.ChecksumIEEE(payload) != binary.LittleEndian.Uint32(header[20:24]) {
			break
		}
		validBytes += int64(recordHeaderBytes + length)
		expectedSequence++
	}
	if err := t.file.Truncate(validBytes); err != nil {
		return fmt.Errorf("repair recording audio spool: %w", err)
	}
	if _, err := t.file.Seek(validBytes, io.SeekStart); err != nil {
		return fmt.Errorf("seek recording audio spool tail: %w", err)
	}
	t.bytesWritten = validBytes
	t.nextSequence = expectedSequence
	t.lastSync = time.Now()
	return nil
}

func (t *track) rollback(offset int64, cause error) error {
	truncateErr := t.file.Truncate(offset)
	_, seekErr := t.file.Seek(offset, io.SeekStart)
	return fmt.Errorf("write recording audio spool: %w", errors.Join(cause, truncateErr, seekErr))
}

func (s Source) filename() string {
	if s == SourceSystem {
		return "system.pcmspool"
	}
	return "microphone.pcmspool"
}
