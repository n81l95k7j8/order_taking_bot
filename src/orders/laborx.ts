// LaborX link helpers.

export interface LaborXLinkInfo {
  url: string;
  type: 'gig' | 'project' | 'vacancy' | 'job' | 'profile' | 'generic';
  id?: string;
}

const LABORX_GIG_REGEX = /https?:\/\/(?:www\.)?laborx\.com\/gigs\/([a-zA-Z0-9_-]+)/i;
const LABORX_PROJECT_REGEX = /https?:\/\/(?:www\.)?laborx\.com\/projects\/([a-zA-Z0-9_-]+)/i;
const LABORX_VACANCY_REGEX = /https?:\/\/(?:www\.)?laborx\.com\/vacancies\/([a-zA-Z0-9_-]+)/i;
const LABORX_JOB_REGEX = /https?:\/\/(?:www\.)?laborx\.com\/jobs\/([a-zA-Z0-9_-]+)/i;
const LABORX_PROFILE_REGEX = /https?:\/\/(?:www\.)?laborx\.com\/freelancers\/users\/([a-zA-Z0-9_-]+)/i;
const LABORX_GENERIC_REGEX = /https?:\/\/(?:www\.)?laborx\.com(?:\/\S*)?/i;

export function parseLaborXLink(text: string): LaborXLinkInfo | null {
  const gigMatch = text.match(LABORX_GIG_REGEX);
  if (gigMatch) {
    return {
      url: gigMatch[0],
      type: 'gig',
      id: gigMatch[1],
    };
  }

  const projectMatch = text.match(LABORX_PROJECT_REGEX);
  if (projectMatch) {
    return {
      url: projectMatch[0],
      type: 'project',
      id: projectMatch[1],
    };
  }

  const vacancyMatch = text.match(LABORX_VACANCY_REGEX);
  if (vacancyMatch) {
    return {
      url: vacancyMatch[0],
      type: 'vacancy',
      id: vacancyMatch[1],
    };
  }

  const jobMatch = text.match(LABORX_JOB_REGEX);
  if (jobMatch) {
    return {
      url: jobMatch[0],
      type: 'job',
      id: jobMatch[1],
    };
  }

  const profileMatch = text.match(LABORX_PROFILE_REGEX);
  if (profileMatch) {
    return {
      url: profileMatch[0],
      type: 'profile',
      id: profileMatch[1],
    };
  }

  const genericMatch = text.match(LABORX_GENERIC_REGEX);
  if (genericMatch) {
    return {
      url: genericMatch[0],
      type: 'generic',
    };
  }

  return null;
}

export function formatLaborXLink(info: LaborXLinkInfo): string {
  const typeLabel = info.type === 'gig'
    ? '🎯 Gig'
    : info.type === 'project'
      ? '📋 Project'
      : info.type === 'vacancy'
        ? '💼 Vacancy'
        : info.type === 'job'
          ? '🧾 Job'
          : info.type === 'profile'
            ? '👤 Profile'
            : '🔗 LaborX';
  return `${typeLabel}: ${info.url}`;
}

export function containsLaborXLink(text: string): boolean {
  return LABORX_GENERIC_REGEX.test(text);
}
