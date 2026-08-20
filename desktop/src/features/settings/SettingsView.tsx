import { DashboardPanel, DashboardPanelBody, DashboardPanelHeader, DashboardPanelTitle } from '@/components/ui/dashboard-panel'
import { useAuth } from '@/features/auth/AuthContext'
import { useExtractFieldsQuery } from '@/features/settings/sections/extracts/useExtractFieldsQuery'
import { useVocabularyQuery } from '@/features/settings/sections/vocabulary/useVocabularyQuery'
import { AccountSettings } from '@/features/settings/sections/account/AccountSettings'
import { BillingSettings } from '@/features/settings/sections/billing/BillingSettings'
import { CalendarSettings } from '@/features/settings/sections/calendar/CalendarSettings'
import { ExtractsSettings } from '@/features/settings/sections/extracts/ExtractsSettings'
import { PreferencesSettings } from '@/features/settings/sections/preferences/PreferencesSettings'
import { ShortcutsSettings } from '@/features/settings/sections/shortcuts/ShortcutsSettings'
import { ConnectorsSettings } from '@/features/settings/sections/connectors/ConnectorsSettings'
import { EmailDraftSettings } from '@/features/settings/sections/email-drafts/EmailDraftSettings'
import { SummaryTemplatesSettings } from '@/features/settings/sections/summary-templates/SummaryTemplatesSettings'
import { VocabularySettings } from '@/features/settings/sections/vocabulary/VocabularySettings'
import { settingsSections, type DashboardSettingsSection } from '@/features/settings/settings-config'

function SettingsSection({ section, userID }: { section: DashboardSettingsSection; userID?: string }) {
  switch (section) {
    case 'account': return <AccountSettings />
    case 'billing': return <BillingSettings />
    case 'calendar': return <CalendarSettings />
    case 'connectors': return <ConnectorsSettings />
    case 'vocabulary': return <VocabularySettings userID={userID} />
    case 'extracts': return <ExtractsSettings userID={userID} />
    case 'emailDraft': return <EmailDraftSettings />
    case 'summaryTemplates': return <SummaryTemplatesSettings />
    case 'preferences': return <PreferencesSettings />
    case 'shortcuts': return <ShortcutsSettings />
  }
}

export default function SettingsView({ selectedSection }: { selectedSection: DashboardSettingsSection }) {
  const { user } = useAuth()

  // Preserve settings-open cache warming while the visible section owns its rendering and mutations.
  useVocabularyQuery(user?.id)
  useExtractFieldsQuery(user?.id)

  return (
    <DashboardPanel className="flex h-full min-h-0 flex-col">
      <DashboardPanelHeader className="px-2.5 py-2">
        <div className="flex h-8 w-full items-center">
          <DashboardPanelTitle>{settingsSections[selectedSection].title}</DashboardPanelTitle>
        </div>
      </DashboardPanelHeader>
      <DashboardPanelBody className="min-h-0 flex-1 overflow-y-auto">
        <SettingsSection section={selectedSection} userID={user?.id} />
      </DashboardPanelBody>
    </DashboardPanel>
  )
}
