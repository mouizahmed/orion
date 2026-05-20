package email

import (
	"log"

	resend "github.com/resend/resend-go/v2"
)

type Config struct {
	NoReply       string // e.g. "Orion <noreply@withorion.app>"
	Notifications string // e.g. "Orion <notifications@withorion.app>"
	Billing       string // e.g. "Orion <billing@withorion.app>"
}

type Service struct {
	client *resend.Client
	cfg    Config
}

func NewService(apiKey string, cfg Config) *Service {
	if apiKey == "" {
		log.Println("email: RESEND_API_KEY not set — emails disabled")
	}
	return &Service{
		client: resend.NewClient(apiKey),
		cfg:    cfg,
	}
}

func (s *Service) send(from, to, subject, html string) error {
	_, err := s.client.Emails.Send(&resend.SendEmailRequest{
		From:    from,
		To:      []string{to},
		Subject: subject,
		Html:    html,
	})
	return err
}
