// Shared localStorage-backed store for reusable "knowledge base" templates
// (name + company info + FAQs), used by both KnowledgeBase.jsx (the library
// page) and AgentDetail.jsx (the per-agent "Your knowledge bases" section +
// "Import from knowledge base" picker). No backend table exists for these —
// they're cross-agent within this browser, but don't sync across devices.
const STORAGE_KEY = 'kb_saved_templates_v1';

export const loadKbTemplates = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
};

export const persistKbTemplates = (list) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore quota errors */ }
};

export const qaCount = (faqs) => (String(faqs || '').match(/^Q:/gm) || []).length;
