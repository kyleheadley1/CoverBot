import { RequestHandler } from 'express';
import { ServerError } from '../types';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
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

  const role = `You're an expert job search consultant who is helping a client seek a new tech role`;
  const task = `
        The user content will be a job description.  
        1. read through the job description and identify the target audience, key skills and company values
        2. read through the resume provided below and find relevant experience to the job description
        3. format a cover letter for the candidate in the following structure:

        Dear [target audience],

        cover letter content

        All the best,
        Kyle Headley
        347-740-2661
        kheadley.dev@gmail.com
`;

  // Read resume from file
  const resumeFilePath = path.join(
    __dirname,
    '../data/Kyle Headley - Resume.docx'
  );
  
  let resume: string;
  try {
    const result = await mammoth.extractRawText({ path: resumeFilePath });
    resume = result.value;
  } catch (err) {
    const error: ServerError = {
      log: `Failed to read resume file: ${(err as Error).message}`,
      status: 500,
      message: { err: 'An error occurred while reading the resume file' },
    };
    return next(error);
  }

  const rules = `
  1. output format should be in markdown formatted left justified, single spaced with 2 lines between paragraphs and after the salutation. Like a letter 
  2. It should not include ANY additional content than the cover letter itself          
  3. don't lie or make up any experience to better fit the job description, only use the experience listed and what can be logically inferred from that experience
  4. don't directly quote anything from the job description.  If you want to tie a link between experience and job requirements, at least change the wording enough so its not a direct pull
`;

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
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        { role: 'user', content: naturalLanguageQuery },
      ],
      temperature: 0.3,
      max_completion_tokens: 500,
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
