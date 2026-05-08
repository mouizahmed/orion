# App Profile Plan

## Goal

Make `users.name` and `users.avatar_url` the Orion-owned app profile. OAuth providers should seed the profile on first login, but after account creation Google and Microsoft should behave as login identities, not as the ongoing source of truth for the app profile.

## Current Model

- `users` stores the app account:
  - `id`
  - `email`
  - `name`
  - `avatar_url`
- `user_auth_identities` stores provider login identities:
  - `user_id`
  - `provider`
  - `provider_user_id`
  - `provider_email`
  - `display_name`
  - `avatar_url`
  - `raw_claims`

One `users` row can have multiple provider identities.

## OAuth Rules

- New user:
  - Seed `users.name` from provider display name.
  - Seed `users.avatar_url` from provider avatar when available.
  - Store provider snapshot in `user_auth_identities`.
- Existing user:
  - Preserve `users.name` unless it is empty.
  - Preserve `users.avatar_url` unless it is empty.
  - Continue updating the matching `user_auth_identities` row with the latest provider snapshot.
- Email remains the account linking key for new provider identities, matched case-insensitively.
- Do not auto-link different provider emails unless the user is already signed in and explicitly connects another provider.

## Backend Work

1. Add `PATCH /api/user/me`.
   - Requires Firebase auth middleware.
   - Accepts display name updates.
   - Trims whitespace.
   - Rejects empty names.
   - Enforces a reasonable max length.
   - Updates `users.name`.
   - Returns the updated user in the same shape as `GET /api/user/me`.

2. Add `POST /api/user/me/avatar`.
   - Requires Firebase auth middleware.
   - Accepts multipart image upload.
   - Validates size and MIME type with `internal/profile`.
   - Uploads through `profile.AvatarService`.
   - Updates `users.avatar_url`.
   - Returns the updated user in the same shape as `GET /api/user/me`.

3. Keep avatar storage logic centralized.
   - Reuse `profile.AvatarService`.
   - Do not duplicate B2 upload logic in handlers.
   - Keep provider photo caching and user avatar upload on the same validation path.

## Desktop Work

1. Account settings display name editing.
   - Show current app profile name.
   - Allow editing and saving.
   - Disable save while unchanged or invalid.
   - Update local profile state from the API response.

2. Account settings avatar editing.
   - Show current app profile avatar.
   - Add a change-avatar control.
   - Use native file selection.
   - Upload the selected image to `POST /api/user/me/avatar`.
   - Update sidebar and account settings immediately from the API response.

3. Keep Firebase profile data out of the UI source of truth.
   - Desktop should continue using `/api/user/me` for app profile display.
   - Firebase remains the auth/session layer.

## Not In Scope Yet

- Removing old avatar files from B2.
- Cropping or image editing.
- Explicit connect-provider UI for linking different provider emails.
- Showing linked provider identities in Account settings.

## Verification

- Backend:
  - `go test ./...`
  - Manual auth smoke test for Google and Microsoft.
  - Manual profile update and avatar upload test.
- Desktop:
  - `npx tsc --noEmit --pretty false`
  - Verify sidebar and Account settings update without restart after profile changes.
