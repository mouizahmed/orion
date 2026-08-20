import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/AuthContext'
import { SettingRow } from './SettingsPrimitives'

export function AccountSettings() {
  const { user, logout, logoutAllDevices, updateProfileName, uploadProfileAvatar } = useAuth()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileAction, setProfileAction] = useState<'name' | 'avatar' | null>(null)

  useEffect(() => setProfileName(user?.name || ''), [user?.name])

  const trimmedProfileName = profileName.trim()
  const canSaveProfileName = Boolean(user) && trimmedProfileName !== '' && trimmedProfileName !== (user?.name || '')

  const saveProfileName = useCallback(async () => {
    if (!canSaveProfileName) return
    setProfileAction('name')
    try {
      await updateProfileName(trimmedProfileName)
      toast.success('Name updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update name')
    } finally {
      setProfileAction(null)
    }
  }, [canSaveProfileName, trimmedProfileName, updateProfileName])

  const changeAvatar = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setProfileAction('avatar')
    try {
      await uploadProfileAvatar(file)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update avatar')
    } finally {
      setProfileAction(null)
    }
  }, [uploadProfileAvatar])

  const displayName = user?.name || user?.email || 'Account'
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'S'

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center gap-3 border-b border-neutral-200 px-3 py-3 dark:border-white/10">
          <div className="shrink-0">
            {user?.picture ? (
              <img src={user.picture} alt="" className="h-12 w-12 rounded-full object-cover" draggable={false} referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-700 dark:bg-white/10 dark:text-white">{initials}</div>
            )}
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={changeAvatar} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{displayName}</div>
            <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{user?.email || 'Not signed in'}</div>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!user || profileAction === 'avatar'} onClick={() => avatarInputRef.current?.click()}>
            {profileAction === 'avatar' ? 'Saving' : 'Change photo'}
          </Button>
        </div>
        <SettingRow
          label="Name"
          action={
            <div className="flex w-[320px] max-w-[45vw] items-center gap-2">
              <Input
                value={profileName}
                disabled={!user || profileAction === 'name'}
                maxLength={120}
                onChange={(event) => setProfileName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveProfileName()
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={!canSaveProfileName || profileAction === 'name'} onClick={() => void saveProfileName()}>
                {profileAction === 'name' ? 'Saving' : 'Save'}
              </Button>
            </div>
          }
        />
        <SettingRow label="Email" value={user?.email || 'Not signed in'} />
      </div>
      <div className="space-y-2">
        <div className="px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Session management</div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <SettingRow label="Session" value="Manage sign-in on this device." action={<Button type="button" variant="outline" size="sm" onClick={logout}>Log out</Button>} />
          <SettingRow label="All sessions" value="Revoke every device and close active live connections." action={<Button type="button" variant="outline" size="sm" onClick={() => void logoutAllDevices()}>Log out everywhere</Button>} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Data management</div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <SettingRow label="Export data" value="Generate a CSV export of your meeting notes, typically ready within a few hours." action={<Button type="button" variant="outline" size="sm" disabled>Generate CSV</Button>} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Danger zone</div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <SettingRow label="Delete my account" value="Permanently delete your account and all synced data." action={<Button type="button" variant="destructive" size="sm" disabled>Delete my account</Button>} />
        </div>
      </div>
    </div>
  )
}
