export const MAGNETIC_ARCH_ORGANIZATION_ID =
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const MAGNETIC_ARCH_ORGANIZATION_SLUG = 'magnetic-arch-plasma-showcase';
export const MAGNETIC_ARCH_MARKER = 'magnetic-arch-plasma-example';
export const MAGNETIC_ARCH_SOURCE = {
  title:
    'Magnetic arch plasma expansion in a cluster of two ECR plasma sources',
  doi: '10.5281/zenodo.13987138',
  url: 'https://zenodo.org/records/13987138',
  creators: ['Celian Boye', 'Mario Merino', 'Jaume Navarro Cavalle'],
  collected: '2023-02 to 2023-03',
  licenseNote:
    'The source description and structured license metadata differ; consult the Zenodo record for reuse terms.',
} as const;

export interface ResearchExampleConfig {
  key: string;
  organizationId: string;
  organizationSlug: string;
  organization: string;
  marker: string;
  curatorUsername?: string;
  expectedArtifactCount: number;
  summary: string;
  source: {
    title: string;
    doi: string;
    url: string;
    creators: readonly string[];
    collected: string;
    licenseNote: string;
  };
}

export const RESEARCH_EXAMPLES: readonly ResearchExampleConfig[] = [
  {
    key: 'magnetic-arch',
    organizationId: MAGNETIC_ARCH_ORGANIZATION_ID,
    organizationSlug: MAGNETIC_ARCH_ORGANIZATION_SLUG,
    organization: 'Magnetic Arch Plasma Showcase',
    marker: MAGNETIC_ARCH_MARKER,
    expectedArtifactCount: 5,
    summary:
      'Five experimental plasma configurations with 80 source-file fingerprints.',
    source: MAGNETIC_ARCH_SOURCE,
  },
  {
    key: 'eeg-eye-state',
    organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizationSlug: 'neuroscience-gateway',
    organization: 'Neuroscience Gateway',
    marker: 'osc-curated-eeg-eye-state',
    curatorUsername: 'research-curator-nsg',
    expectedArtifactCount: 1,
    summary: 'A published 14-channel EEG recording and its eye-state labels.',
    source: {
      title: 'EEG Eye State',
      doi: '10.24432/C57G7J',
      url: 'https://archive.ics.uci.edu/dataset/264/eeg+eye+state',
      creators: ['Oliver Roesler'],
      collected: 'Collection date not stated by UCI; dataset donated in 2013',
      licenseNote:
        'UCI lists CC BY 4.0. Credit the original creator when reusing the data.',
    },
  },
  {
    key: 'serengeti-reproduction',
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organizationSlug: 'citizen-science',
    organization: 'Citizen Science',
    marker: 'osc-curated-serengeti-reproduction',
    curatorUsername: 'research-curator-cs',
    expectedArtifactCount: 2,
    summary:
      'Volunteer and trained-observer classifications from a Serengeti camera-trap study.',
    source: {
      title:
        'Can citizen science analysis of camera trap data be used to study reproduction? Lessons from Snapshot Serengeti program',
      doi: '10.5281/zenodo.4639695',
      url: 'https://zenodo.org/records/4639695',
      creators: [
        'Lucie Thel',
        'Simon Chamaillé-Jammes',
        'Léa Keurinck',
        'Maxime Catala',
        'Craig Packer',
        'Sarah Huebner',
        'Christophe Bonenfant',
      ],
      collected: 'Camera-trap sequences from 2010 to 2013',
      licenseNote:
        'Zenodo lists CC BY 4.0. Credit the study authors and the Snapshot Serengeti program.',
    },
  },
];
