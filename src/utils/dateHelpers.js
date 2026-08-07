export const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last7' },
  { label: 'This Month', value: 'thisMonth' },
  { label: 'Last Month', value: 'lastMonth' },
];

/**
 * Returns { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } based on preset key
 */
export const getDateRange = (key) => {
  const now = new Date();
  const format = (date) => date.toISOString().slice(0, 10);

  switch (key) {
    case 'today':
      return { from: format(now), to: format(now) };

    case 'yesterday':
      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      return { from: format(yesterday), to: format(yesterday) };

    case 'last7':
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 6);
      return { from: format(sevenDaysAgo), to: format(now) };

    case 'thisMonth':
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: format(firstOfThisMonth), to: format(now) };

    case 'lastMonth':
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: format(firstOfLastMonth), to: format(lastOfLastMonth) };

    default:
      return { from: format(now), to: format(now) };
  }
};