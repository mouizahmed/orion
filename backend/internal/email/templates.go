package email

import "fmt"

func welcomeTemplate(name string) (subject, html string) {
	displayName := name
	if displayName == "" {
		displayName = "there"
	}
	subject = "Welcome to Orion"
	html = fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;border:1px solid #e5e5e5;">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#111;">Welcome to Orion, %s!</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444;">
            Your AI-powered meeting assistant is ready. Start by linking your calendar and joining your first meeting.
          </p>
          <p style="margin:0;font-size:13px;color:#888;">— The Orion team</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`, displayName)
	return
}

func noteShareInviteTemplate(fromName, noteTitle string) (subject, html string) {
	from := fromName
	if from == "" {
		from = "Someone"
	}
	title := noteTitle
	if title == "" {
		title = "a note"
	}
	subject = fmt.Sprintf("%s shared a note with you", from)
	html = fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;border:1px solid #e5e5e5;">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#111;">%s shared a note with you</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444;">
            You now have access to <strong>%s</strong> in Orion.
          </p>
          <p style="margin:0;font-size:13px;color:#888;">— The Orion team</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`, from, title)
	return
}
