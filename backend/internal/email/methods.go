package email

func (s *Service) SendWelcome(to, name string) error {
	subject, html := welcomeTemplate(name)
	return s.send(s.cfg.NoReply, to, subject, html)
}
