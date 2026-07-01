export interface OrderData {
  description?: string;
  budget?: string;
  deadline?: string;
  techStack?: string;
  contactInfo?: string;
}

export interface CompleteOrderData {
  description: string;
  budget: string;
  deadline: string;
  techStack: string;
}

export type OrderState =
  | 'idle'
  | 'waiting_description'
  | 'waiting_budget'
  | 'waiting_deadline'
  | 'waiting_tech'
  | 'waiting_contact'
  | 'confirming';

export const BUDGET_OPTIONS = [
  { text: '💰 Up to $500', value: 'under_500' },
  { text: '💰💰 $500 - $2000', value: '500_2000' },
  { text: '💰💰💰 $2000 - $5000', value: '2000_5000' },
  { text: '💎 Over $5000', value: 'over_5000' },
  { text: '🤔 Not sure / Let\'s discuss', value: 'unknown' },
];

export const DEADLINE_OPTIONS = [
  { text: '⚡ Urgent (1-3 days)', value: 'urgent' },
  { text: '📅 1-2 weeks', value: '1_2_weeks' },
  { text: '📅 2-4 weeks', value: '2_4_weeks' },
  { text: '🗓 1 month+', value: 'month_plus' },
  { text: '🤝 No fixed deadline', value: 'no_deadline' },
];

export const CALLBACK = {
  ORDER_START: 'order_start',
  ORDER_CANCEL: 'order_cancel',
  ORDER_CONFIRM: 'order_confirm',
  ORDER_REJECT: 'order_reject',
  ORDER_EDIT: 'order_edit',
  FAQ: 'faq',
} as const;

export function isCompleteOrder(order: OrderData): order is CompleteOrderData {
  return !!(
    order.description &&
    order.budget &&
    order.deadline &&
    order.techStack
  );
}
