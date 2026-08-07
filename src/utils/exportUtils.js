/**
 * Professional CSV Export Utility
 * @param {Array} data - The array of objects to export
 * @param {Array} columns - Config array: [{ label: 'Column Name', key: 'objectKey' }]
 * @param {string} filename - Desired filename without extension
 */
export const exportToCsv = (data, columns, filename = 'report') => {
  if (!data || !data.length) return;

  // 1. Create Header Row
  const headers = columns.map(col => col.label).join(',');

  // 2. Create Data Rows
  const rows = data.map(record => {
    return columns.map(col => {
      let value = record[col.key];
      
      // Clean and format values
      if (value === null || value === undefined) value = '';
      
      // Escape quotes and wrap in quotes to handle commas within strings
      const stringValue = String(value).replace(/"/g, '""');
      return `"${stringValue}"`;
    }).join(',');
  });

  // 3. Assemble CSV
  const csvContent = [headers, ...rows].join('\n');
  
  // 4. Create Blob and Trigger Download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}-${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};