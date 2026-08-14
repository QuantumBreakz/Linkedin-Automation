/**
 * Prisma database seed script for development and testing.
 *
 * Populates sample academic user, brand voice profile, schedule slots,
 * research papers, extractions, and drafts.
 *
 * Run via: `npx prisma db seed`
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding development database...');

  // Create demo user
  const user = await prisma.user.upsert({
    where: { email: 'demo@university.edu' },
    create: {
      email: 'demo@university.edu',
      name: 'Dr. Elena Rostova',
      title: 'Principal Investigator in NeuroAI',
      fieldOfStudy: 'Computational Neuroscience & Deep Learning',
      timezone: 'America/New_York',
    },
    update: {},
  });

  // Create brand profile
  await prisma.brandProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      tone: 'PROFESSIONAL',
      technicality: 'INTERMEDIATE',
      postLength: 'MEDIUM',
      emojiUsage: 'LOW',
      firstPerson: true,
      ctaEnabled: true,
      hashtagsEnabled: true,
      customInstructions: 'Focus on biological plausibility and clinical translation.',
      styleSamples: [
        {
          post: 'Excited to share our latest findings on synaptic plasticity modeling. We observed a 3.4x improvement in energy efficiency when combining spiking neural networks with dendritic gating.',
        },
      ],
    },
    update: {},
  });

  // Create schedule slots (Tuesday 09:00, Thursday 14:00)
  await prisma.scheduleSlot.upsert({
    where: {
      userId_dayOfWeek_timeOfDay: {
        userId: user.id,
        dayOfWeek: 2, // Tuesday
        timeOfDay: '09:00',
      },
    },
    create: {
      userId: user.id,
      dayOfWeek: 2,
      timeOfDay: '09:00',
      active: true,
    },
    update: {},
  });

  await prisma.scheduleSlot.upsert({
    where: {
      userId_dayOfWeek_timeOfDay: {
        userId: user.id,
        dayOfWeek: 4, // Thursday
        timeOfDay: '14:00',
      },
    },
    create: {
      userId: user.id,
      dayOfWeek: 4,
      timeOfDay: '14:00',
      active: true,
    },
    update: {},
  });

  // Create a sample research paper
  const paper = await prisma.researchPaper.upsert({
    where: {
      userId_canonicalKey: {
        userId: user.id,
        canonicalKey: 'doi:10.1038/s41586-024-0001-x',
      },
    },
    create: {
      userId: user.id,
      canonicalKey: 'doi:10.1038/s41586-024-0001-x',
      doi: '10.1038/s41586-024-0001-x',
      openalexId: 'W4389201928',
      title: 'Energy-efficient spike-based neural decoding across cortical microcircuits',
      abstract:
        'Brain-computer interfaces require energy-constrained neural decoding. Here we present a spiking architecture achieving 94.2% decoding accuracy with a 4.1x reduction in power consumption across 12 in-vivo primate recordings.',
      publicationDate: new Date('2025-06-15'),
      venue: 'Nature Neuroscience',
      landingUrl: 'https://doi.org/10.1038/s41586-024-0001-x',
      fullTextStatus: 'OA_PDF',
      topics: ['Neuroscience', 'Artificial Intelligence', 'Brain-Computer Interfaces'],
      citedByCount: 42,
      raw: {},
      authors: {
        create: [
          { name: 'Elena Rostova', position: 0, isUser: true },
          { name: 'Marcus Chen', position: 1, isUser: false },
          { name: 'Sarah Al-Mansoor', position: 2, isUser: false },
        ],
      },
    },
    update: {},
  });

  // Create analysis
  const analysis = await prisma.paperAnalysis.upsert({
    where: {
      paperId_version: {
        paperId: paper.id,
        version: 1,
      },
    },
    create: {
      paperId: paper.id,
      version: 1,
      extraction: {
        problem: {
          value: 'Brain-computer interfaces suffer from high power consumption during real-time decoding.',
          provenance: 'STATED',
          evidence: 'Brain-computer interfaces require energy-constrained neural decoding.',
        },
        researchQuestion: {
          value: 'Can spike-based neural decoding reduce power while maintaining high accuracy?',
          provenance: 'STATED',
          evidence: 'Here we present a spiking architecture achieving 94.2% decoding accuracy',
        },
        methodology: {
          value: 'Spiking neural network architecture evaluated across 12 in-vivo primate recordings.',
          provenance: 'STATED',
          evidence: 'across 12 in-vivo primate recordings',
        },
        novelty: {
          value: 'First neuromorphic decoder demonstrating sub-milliwatt operation with clinical-grade accuracy.',
          provenance: 'INFERRED',
          evidence: null,
        },
        keyFindings: [
          {
            value: 'Achieved 94.2% decoding accuracy in real-time decoding tasks.',
            provenance: 'STATED',
            evidence: 'achieving 94.2% decoding accuracy',
          },
          {
            value: 'Demonstrated 4.1x reduction in power consumption compared to baseline transformers.',
            provenance: 'STATED',
            evidence: 'with a 4.1x reduction in power consumption',
          },
          {
            value: 'Validated across 12 in-vivo primate recordings with consistent latency.',
            provenance: 'STATED',
            evidence: 'across 12 in-vivo primate recordings',
          },
        ],
        importantNumbers: [
          { metric: 'Decoding Accuracy', value: '94.2%', context: 'real-time motor intent decoding', evidence: '94.2% decoding accuracy' },
          { metric: 'Power Reduction', value: '4.1x', context: 'compared to standard microprocessors', evidence: '4.1x reduction in power consumption' },
        ],
      },
      provenance: { problem: 'STATED', methodology: 'STATED', findings: 'STATED' },
      basedOn: 'OA_PDF',
      confidence: 0.95,
      modelId: 'google/gemini-pro-1.5',
      promptHash: 'seed_prompt_hash_001',
    },
    update: {},
  });

  // Create content draft
  await prisma.contentDraft.upsert({
    where: { id: 'seed-draft-001' },
    create: {
      id: 'seed-draft-001',
      userId: user.id,
      paperId: paper.id,
      analysisId: analysis.id,
      format: 'RESEARCH_BREAKDOWN',
      body: `One of the largest hurdles in neural prosthetics has been power: real-time decoding burns battery fast.\n\nIn our new work published in Nature Neuroscience, we show how a spiking architecture can decode motor intent at 94.2% accuracy while cutting power consumption by 4.1x across 12 in-vivo primate datasets.\n\nKey takeaways:\n1. 94.2% decoding accuracy maintained in real-time.\n2. 4.1x power reduction compared to conventional models.\n3. Robust generalization across 12 animal subjects.\n\nProud of the team at the NeuroAI Lab for making this possible!`,
      hashtags: ['#Neuroscience', '#MachineLearning', '#BrainComputerInterfaces', '#Research'],
      linkUrl: 'https://doi.org/10.1038/s41586-024-0001-x',
      status: 'APPROVED',
      verificationStatus: 'PASSED',
      verification: {
        claims: [
          { text: '94.2% decoding accuracy', status: 'SUPPORTED', supportingField: 'keyFindings', note: null },
          { text: '4.1x power reduction', status: 'SUPPORTED', supportingField: 'keyFindings', note: null },
        ],
        numbersMatch: true,
        overstatement: false,
        medicalAdviceRisk: false,
        verdict: 'PASS',
      },
    },
    update: {},
  });

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
