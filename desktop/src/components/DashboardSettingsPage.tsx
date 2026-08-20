import { Fragment } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Keyboard,
  LayoutGrid,
  Mail,
  MonitorCog,
  ScanText,
  SpellCheck,
  User,
} from 'lucide-react'

import { DashboardPanel, DashboardPanelBody, DashboardPanelHeader, DashboardPanelTitle } from '@/components/ui/dashboard-panel'
import { SidebarRowButton } from '@/components/ui/sidebar-button'
import { useAuth } from '@/contexts/AuthContext'
import { useExtractFieldsQuery } from '@/hooks/useExtractFieldsQuery'
import { useVocabularyQuery } from '@/hooks/useVocabularyQuery'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { BillingSettings } from '@/components/settings/BillingSettings'
import { CalendarSettings } from '@/components/settings/CalendarSettings'
import { ExtractsSettings } from '@/components/settings/ExtractsSettings'
import { PreferencesSettings } from '@/components/settings/PreferencesSettings'
import { ShortcutsSettings } from '@/components/settings/ShortcutsSettings'
import {
  ConnectorsSettings,
  EmailDraftSettings,
  SummaryTemplatesSettings,
} from '@/components/settings/StaticSettings'
import { VocabularySettings } from '@/components/settings/VocabularySettings'

export type DashboardSettingsSection = 'account' | 'billing' | 'calendar' | 'connectors' | 'vocabulary' | 'extracts' | 'emailDraft' | 'summaryTemplates' | 'preferences' | 'shortcuts'

const sectionMeta: Record<DashboardSettingsSection, { title: string; icon: typeof User }> = {
  account: { title: 'Account', icon: User },
  billing: { title: 'Billing', icon: CreditCard },
  calendar: { title: 'Calendar', icon: CalendarDays },
  connectors: { title: 'Connectors', icon: LayoutGrid },
  vocabulary: { title: 'Vocabulary', icon: SpellCheck },
  extracts: { title: 'Extracts', icon: ScanText },
  emailDraft: { title: 'Email Draft Templates', icon: Mail },
  summaryTemplates: { title: 'Summary Templates', icon: ClipboardList },
  preferences: { title: 'Preferences', icon: MonitorCog },
  shortcuts: { title: 'Shortcuts', icon: Keyboard },
}

export function DashboardSettingsNav({
  selectedSection,
  onSelectSection,
  onBackToApp,
}: {
  selectedSection: DashboardSettingsSection
  onSelectSection: (section: DashboardSettingsSection) => void
  onBackToApp: () => void
}) {
  return (
    <div className="space-y-1">
      <SidebarRowButton style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} onClick={onBackToApp}>
        <ArrowLeft size={14} />
        <span>Back to app</span>
      </SidebarRowButton>
      <div className="-mx-1 border-t border-neutral-200 dark:border-white/10" />
      {(Object.keys(sectionMeta) as DashboardSettingsSection[]).map((section) => {
        const Icon = sectionMeta[section].icon
        return (
          <Fragment key={section}>
            {section === 'calendar' || section === 'vocabulary' || section === 'preferences' ? <div className="my-1 border-t border-neutral-200 dark:border-white/10" /> : null}
            <SidebarRowButton
              active={selectedSection === section}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => onSelectSection(section)}
            >
              <Icon size={14} />
              <span>{sectionMeta[section].title}</span>
            </SidebarRowButton>
          </Fragment>
        )
      })}
    </div>
  )
}

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

export default function DashboardSettingsPage({ selectedSection }: { selectedSection: DashboardSettingsSection }) {
  const { user } = useAuth()

  // Preserve settings-open cache warming while the visible section owns its rendering and mutations.
  useVocabularyQuery(user?.id)
  useExtractFieldsQuery(user?.id)

  return (
    <DashboardPanel className="flex h-full min-h-0 flex-col">
      <DashboardPanelHeader className="px-2.5 py-2">
        <div className="flex h-8 w-full items-center">
          <DashboardPanelTitle>{sectionMeta[selectedSection].title}</DashboardPanelTitle>
        </div>
      </DashboardPanelHeader>
      <DashboardPanelBody className="min-h-0 flex-1 overflow-y-auto">
        <SettingsSection section={selectedSection} userID={user?.id} />
      </DashboardPanelBody>
    </DashboardPanel>
  )
}
