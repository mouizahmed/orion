import { Check, Sparkles } from 'lucide-react'

import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { DashboardIconTile, DashboardRow } from '@/components/ui/dashboard-row'
import { Input } from '@/components/ui/input'

export function PlanBody() {
  const plans = [
    {
      name: 'Pro',
      price: '$8',
      items: ['1500 minutes / month', 'AI meeting notes', 'Follow-up summaries'],
    },
    {
      name: 'Team',
      price: '$20',
      items: ['Everything in Pro', '3000 minutes / month', 'Shared workspace'],
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 pt-3">
      {plans.map((plan) => (
        <DashboardPanel key={plan.name}>
          <DashboardPanelHeader className="block p-3">
            <DashboardPanelTitle className="text-sm">{plan.name}</DashboardPanelTitle>
            <div className="mt-2 flex items-baseline gap-1 text-neutral-950 dark:text-neutral-100">
              <span className="text-2xl font-semibold">{plan.price}</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">/mo</span>
            </div>
          </DashboardPanelHeader>
          <DashboardPanelBody className="space-y-1.5 px-3 pb-3 pt-0">
            {plan.items.map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                <Check className="h-3 w-3 text-neutral-400" />
                <span>{item}</span>
              </div>
            ))}
          </DashboardPanelBody>
        </DashboardPanel>
      ))}
    </div>
  )
}

export function ProfileBody() {
  return (
    <DashboardPanel className="mt-3">
      <DashboardPanelBody className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Input value="Matthew" readOnly aria-label="First name" />
          <Input placeholder="Last name" aria-label="Last name" />
        </div>
        <Input value="staxvalorant@gmail.com" readOnly aria-label="Email" />
        <Input placeholder="Role, e.g. Account Manager" aria-label="Role" />
      </DashboardPanelBody>
    </DashboardPanel>
  )
}

export function SuggestionsBody() {
  const rows = [
    ['Balance the conversation', 'Nudge when one person is talking too much'],
    ['Remind must-ask questions', 'Surface timeline and scope prompts'],
    ['Search past answers', 'Bring relevant notes into the moment'],
  ]

  return (
    <DashboardPanel className="mt-3">
      <DashboardPanelBody className="space-y-0.5">
        {rows.map(([title, description]) => (
          <DashboardRow key={title} className="items-center">
            <DashboardIconTile className="h-8 w-8">
              <Sparkles className="h-4 w-4" />
            </DashboardIconTile>
            <div className="min-w-0">
              <div className="text-xs font-medium text-neutral-800 dark:text-neutral-200">{title}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{description}</div>
            </div>
          </DashboardRow>
        ))}
      </DashboardPanelBody>
    </DashboardPanel>
  )
}
