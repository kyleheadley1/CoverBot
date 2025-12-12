import { RequestHandler } from 'express';
import { ServerError } from '../types';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OpenAI({ apiKey: process.env.OPEN_AI_KEY });

export const queryOpenAI: RequestHandler = async (_req, res, next) => {
  const { naturalLanguageQuery } = res.locals;
  if (!naturalLanguageQuery) {
    const error: ServerError = {
      log: 'OpenAI query middleware did not receive a query',
      status: 500,
      message: { err: 'An error occurred before querying OpenAI' },
    };
    return next(error);
  }

  // Read resume from file
  const resumeFilePath = path.join(
    __dirname,
    '../data/Kyle Headley - Resume-7.pdf'
  );
  
  let resume: string;
  try {
    const dataBuffer = fs.readFileSync(resumeFilePath);
    const result = await pdfParse(dataBuffer);
    resume = result.text;
  } catch (err) {
    const error: ServerError = {
      log: `Failed to read resume file: ${(err as Error).message}`,
      status: 500,
      message: { err: 'An error occurred while reading the resume file' },
    };
    return next(error);
  }

  const role = `You are Kyle Headley writing a cover letter in first person.`;
  const task = `Read the job description and resume. Write a cover letter with this structure:

Dear [target audience],

[cover letter content]

All the best,
Kyle Headley
347-740-2661
kheadley.dev@gmail.com`;

  const rules = `Style: Natural, conversational first-person. Varied sentences. Authentic enthusiasm. Specific examples from resume. Avoid AI clichés ("I am excited", "I am passionate"). No buzzwords. Write like a conversation, not a template.

Content: Only use experience from resume. Don't quote job description - paraphrase naturally. Focus on 2-3 key connections with depth. Be specific about company values.

Format: Markdown, left-justified, single-spaced, 2 lines between paragraphs. Only the cover letter - no extra content.`;

  const systemPrompt = `
  ${role}
  ${task}

  ${resume}

  Rules: 
  ${rules}
`;

  //  Path to the queries.json file
  const queriesFilePath = path.join(__dirname, '../data/cover_letters.json');

  // Read and update the queries.json file
  let queriesData: Record<string, Array<{ returnedQuery: string }>> = {};
  if (fs.existsSync(queriesFilePath)) {
    const fileContent = fs.readFileSync(queriesFilePath, 'utf-8');
    queriesData = fileContent ? JSON.parse(fileContent) : {};
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        { role: 'user', content: naturalLanguageQuery },
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const returnedQuery = response.choices[0].message.content
      ? response.choices[0].message.content
      : null;

    if (!returnedQuery) {
      const error: ServerError = {
        log: 'OpenAI did not return a valid SQL query',
        status: 500,
        message: { err: 'An error occurred while querying OpenAI' },
      };
      return next(error);
    }

    // Update the queries object
    if (!queriesData[naturalLanguageQuery]) {
      queriesData[naturalLanguageQuery] = [];
    }
    queriesData[naturalLanguageQuery].push({ returnedQuery });

    // Write the updated object back to the file
    fs.writeFileSync(
      queriesFilePath,
      JSON.stringify(queriesData, null, 2),
      'utf-8'
    );

    res.locals.coverLetter = returnedQuery;
    return next();
  } catch (err) {
    const error: ServerError = {
      log: `OpenAI query failed: ${(err as Error).message}`,
      status: 500,
      message: { err: 'An error occurred while querying OpenAI' },
    };
    return next(error);
  }
};
