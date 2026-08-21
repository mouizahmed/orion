import {
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

export type DashboardSettingsSection = 'account' | 'billing' | 'calendar' | 'connectors' | 'vocabulary' | 'extracts' | 'emailDraft' | 'summaryTemplates' | 'preferences' | 'shortcuts'

export const settingsSections: Record<DashboardSettingsSection, { title: string; icon: typeof User }> = {
  account: { title: 'Account', icon: User },
  billing: { title: 'Billing', icon: CreditCard },
  calendar: { title: 'Calendar', icon: CalendarDays },
  connectors: { title: 'Connectors', icon: LayoutGrid },
  vocabulary: { title: 'Vocabulary', icon: SpellCheck },
  extracts: { title: 'Extracts', icon: ScanText },
  emailDraft: { title: 'Email Draft', icon: Mail },
  summaryTemplates: { title: 'Summary Templates', icon: ClipboardList },
  preferences: { title: 'Preferences', icon: MonitorCog },
  shortcuts: { title: 'Shortcuts', icon: Keyboard },
}
