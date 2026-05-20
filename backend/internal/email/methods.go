package email

func (s *Service) SendWelcome(to, name string) error {
	subject, html := welcomeTemplate(name)
	return s.send(s.cfg.NoReply, to, subject, html)
}

func (s *Service) SendNoteShareInvite(to, fromName, noteTitle string) error {
	subject, html := noteShareInviteTemplate(fromName, noteTitle)
	return s.send(s.cfg.Notifications, to, subject, html)
}
