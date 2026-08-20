import { Fragment } from 'react'
import { ArrowLeft } from 'lucide-react'

import { SidebarRowButton } from '@/components/ui/sidebar-button'
import { settingsSections, type DashboardSettingsSection } from '@/features/settings/settings-config'

export function SettingsNav({
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
      {(Object.keys(settingsSections) as DashboardSettingsSection[]).map((section) => {
        const Icon = settingsSections[section].icon
        return (
          <Fragment key={section}>
            {section === 'calendar' || section === 'vocabulary' || section === 'preferences' ? <div className="my-1 border-t border-neutral-200 dark:border-white/10" /> : null}
            <SidebarRowButton active={selectedSection === section} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} onClick={() => onSelectSection(section)}>
              <Icon size={14} />
              <span>{settingsSections[section].title}</span>
            </SidebarRowButton>
          </Fragment>
        )
      })}
    </div>
  )
}
