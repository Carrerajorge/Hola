const FORM_KEYWORDS = [
  'formulario', 'formularios', 'encuesta', 'encuestas', 
  'cuestionario', 'cuestionarios', 'form', 'forms',
  'quiz', 'quizzes', 'survey', 'surveys',
  'crear formulario', 'generar formulario', 'hacer formulario',
  'create form', 'generate form', 'make form',
  'preguntas', 'questions', 'respuestas'
];

const FORM_ACTION_VERBS = [
  'crear', 'crea', 'genera', 'generar', 'hacer', 'haz',
  'create', 'generate', 'make', 'build', 'design'
];

export interface FormIntentResult {
  hasFormIntent: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  mentionDetected: boolean;
  keywordsFound: string[];
  suggestedAction: 'generate' | 'edit' | 'preview' | 'none';
}

export function detectFormIntent(
  prompt: string,
  isGoogleFormsActive: boolean,
  hasMention: boolean
): FormIntentResult {
  const lowerPrompt = prompt.toLowerCase();
  
  if (hasMention || lowerPrompt.includes('@googleforms')) {
    return {
      hasFormIntent: true,
      confidence: 'high',
      mentionDetected: true,
      keywordsFound: ['@GoogleForms'],
      suggestedAction: 'generate'
    };
  }
  
  if (!isGoogleFormsActive) {
    return {
      hasFormIntent: false,
      confidence: 'none',
      mentionDetected: false,
      keywordsFound: [],
      suggestedAction: 'none'
    };
  }
  
  const foundKeywords: string[] = [];
  let hasActionVerb = false;
  let hasFormNoun = false;
  
  for (const keyword of FORM_KEYWORDS) {
    if (lowerPrompt.includes(keyword)) {
      foundKeywords.push(keyword);
      if (['formulario', 'formularios', 'encuesta', 'encuestas', 'cuestionario', 'cuestionarios', 'form', 'forms', 'quiz', 'survey'].includes(keyword)) {
        hasFormNoun = true;
      }
    }
  }
  
  for (const verb of FORM_ACTION_VERBS) {
    if (lowerPrompt.includes(verb)) {
      hasActionVerb = true;
      foundKeywords.push(verb);
      break;
    }
  }
  
  if (hasActionVerb && hasFormNoun) {
    return {
      hasFormIntent: true,
      confidence: 'high',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: 'generate'
    };
  }
  
  if (hasFormNoun && foundKeywords.length >= 2) {
    return {
      hasFormIntent: true,
      confidence: 'medium',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: 'generate'
    };
  }
  
  if (foundKeywords.length > 0) {
    return {
      hasFormIntent: false,
      confidence: 'low',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: 'none'
    };
  }
  
  return {
    hasFormIntent: false,
    confidence: 'none',
    mentionDetected: false,
    keywordsFound: [],
    suggestedAction: 'none'
  };
}

export function extractMentionFromPrompt(prompt: string): { hasMention: boolean; cleanPrompt: string } {
  const mentionRegex = /@GoogleForms\s*/gi;
  const hasMention = mentionRegex.test(prompt);
  const cleanPrompt = prompt.replace(mentionRegex, '').trim();
  
  return { hasMention, cleanPrompt };
}
