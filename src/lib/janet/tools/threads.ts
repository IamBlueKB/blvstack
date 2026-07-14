// JANET Feature 1 — thread tools. list_threads (Ring 1, read) lets her see the
// conversation threads that exist; create_thread (Ring 2, internal act) lets her
// spin up a new named thread, optionally attached to a client. janet_memory is
// shared across every thread — switching context never resets what she knows.

import type { JanetTool } from '../types';
import { listThreads, createThread } from '../threads';

export const threadTools: JanetTool[] = [
  {
    name: 'list_threads',
    description:
      'List the conversation threads. Each thread is a named workspace, optionally attached to a client. Use this to see what threads exist before creating a new one or referencing another.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        include_archived: {
          type: 'boolean',
          description: 'Include archived threads (default false — active only)',
        },
      },
    },
    handler: async (input) => {
      const includeArchived = (input as any)?.include_archived === true;
      const threads = await listThreads({ includeArchived });
      return { count: threads.length, threads };
    },
  },
  {
    name: 'create_thread',
    description:
      'Create a new conversation thread. Optionally attach it to a client by client_id so opening it loads that client\'s context automatically. Use this to organize work by client or topic.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Thread title' },
        client_id: {
          type: 'string',
          description: 'Optional janet_clients id to attach this thread to a client',
        },
      },
      required: ['title'],
    },
    handler: async (input) => {
      const title = (input as any)?.title;
      if (typeof title !== 'string' || !title.trim()) throw new Error('Missing required input: title');
      const client_id = (input as any)?.client_id ?? null;
      const thread = await createThread({ title, client_id });
      return { thread };
    },
  },
];
