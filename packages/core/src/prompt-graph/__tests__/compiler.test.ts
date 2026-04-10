import { describe, expect, it } from 'vitest';
import { SimpleTokenCounter } from '../../prompt/token-budget.js';
import { compilePromptGraph } from '../compiler.js';
import type { PromptGraphDocument } from '../types.js';

describe('compilePromptGraph', () => {
  it('compiles static text and chat history into PromptIR', () => {
    const document: PromptGraphDocument = {
      version: 1,
      rootGroupId: 'root',
      policies: {},
      groups: [{
        id: 'root',
        name: 'Root',
        edges: [],
        nodes: [
          {
            id: 'system-1',
            name: 'System',
            nodeType: 'static_text',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 0 },
            template: 'You are {{char}} helping {{user}}.',
          },
          {
            id: 'history-1',
            name: 'History',
            nodeType: 'chat_history',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 10 },
          },
        ],
      }],
    };

    const ir = compilePromptGraph(document, {
      variables: { char: 'Luna', user: 'Ari' },
      chatHistory: [
        { role: 'user', content: 'Hello {{char}}' },
        { role: 'assistant', content: 'Hi {{user}}' },
      ],
      maxTokens: 2048,
      reservedForReply: 256,
      tokenCounter: new SimpleTokenCounter(),
    });

    expect(ir.metadata).toMatchObject({
      maxTokens: 2048,
      reservedForReply: 256,
      tokenizer: 'simple',
    });
    expect(ir.sections.map((section) => section.name)).toEqual(['System', 'History']);
    expect(ir.sections[0]?.messages[0]?.content).toBe('You are Luna helping Ari.');
    expect(ir.sections[1]?.messages.map((message) => message.content)).toEqual(['Hello Luna', 'Hi Ari']);
    expect(ir.sections[1]?.budgetGroup).toBe('history');
    expect(ir.sections[1]?.pinned).toBe(false);
  });

  it('compiles character, persona, memory and worldbook nodes', () => {
    const document: PromptGraphDocument = {
      version: 1,
      rootGroupId: 'root',
      policies: {},
      groups: [{
        id: 'root',
        name: 'Root',
        edges: [],
        nodes: [
          {
            id: 'char-description',
            name: 'Character Description',
            nodeType: 'character',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 0 },
            part: 'description',
          },
          {
            id: 'persona',
            name: 'Persona',
            nodeType: 'persona',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 1 },
          },
          {
            id: 'memory',
            name: 'Memory',
            nodeType: 'memory',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 2 },
          },
          {
            id: 'worldbook-before',
            name: 'Worldbook Before',
            nodeType: 'worldbook',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 3 },
            position: 'before',
          },
        ],
      }],
    };

    const ir = compilePromptGraph(document, {
      character: { description: 'A precise guardian.' },
      persona: { name: 'Traveler', description: 'An observant visitor.' },
      memorySummary: '- Remembers the observatory ritual.',
      worldbookEntries: [{ id: 'wb-1', content: 'Lore about {{place}}', position: 'before' }],
      variables: { place: 'the observatory' },
      maxTokens: 1024,
      reservedForReply: 128,
    });

    expect(ir.sections.map((section) => section.name)).toEqual([
      'Character Description',
      'Persona',
      'Memory',
      'Worldbook Before',
    ]);
    expect(ir.sections[0]?.messages[0]?.content).toBe('A precise guardian.');
    expect(ir.sections[1]?.messages[0]?.content).toBe('The user is Traveler: An observant visitor.');
    expect(ir.sections[2]?.messages[0]?.content).toBe('[Memory Summary]\n- Remembers the observatory ritual.');
    expect(ir.sections[2]?.budgetGroup).toBe('memory');
    expect(ir.sections[3]?.budgetGroup).toBe('worldbook');
    expect(ir.sections[3]?.messages[0]?.content).toBe('Lore about the observatory');
  });

  it('resolves anchor placement against marker nodes', () => {
    const document: PromptGraphDocument = {
      version: 1,
      rootGroupId: 'root',
      policies: {},
      groups: [{
        id: 'root',
        name: 'Root',
        edges: [],
        nodes: [
          {
            id: 'marker-1',
            name: 'Memory Anchor Marker',
            nodeType: 'marker',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 5 },
            markerId: 'memory-anchor',
          },
          {
            id: 'memory-1',
            name: 'Anchored Memory',
            nodeType: 'memory',
            enabled: true,
            role: 'system',
            placement: { kind: 'anchor', anchorId: 'memory-anchor', order: 1 },
          },
          {
            id: 'tail',
            name: 'Tail',
            nodeType: 'static_text',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 10 },
            template: 'Tail section',
          },
        ],
      }],
    };

    const ir = compilePromptGraph(document, {
      memorySummary: 'Anchored summary',
      maxTokens: 512,
      reservedForReply: 64,
    });

    expect(ir.sections.map((section) => section.name)).toEqual(['Anchored Memory', 'Tail']);
    expect(ir.sections[0]?.order).toBeGreaterThan(5);
    expect(ir.sections[0]?.order).toBeLessThan(ir.sections[1]?.order ?? 0);
    expect(ir.sections[0]?.messages[0]?.content).toBe('[Memory Summary]\nAnchored summary');
  });

  it('maps outlet worldbook entries onto matching anchor markers and preserves in-chat insertion', () => {
    const document: PromptGraphDocument = {
      version: 1,
      rootGroupId: 'root',
      policies: {},
      groups: [{
        id: 'root',
        name: 'Root',
        edges: [],
        nodes: [
          {
            id: 'history',
            name: 'History',
            nodeType: 'chat_history',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 0 },
          },
          {
            id: 'outlet-marker',
            name: 'Lore Outlet Marker',
            nodeType: 'marker',
            enabled: true,
            role: 'system',
            placement: { kind: 'in_chat', depth: 1, order: 3 },
            markerId: 'LoreOutlet',
          },
          {
            id: 'outlet-worldbook',
            name: 'Worldbook Outlet LoreOutlet',
            nodeType: 'worldbook',
            enabled: true,
            role: 'system',
            placement: { kind: 'anchor', anchorId: 'LoreOutlet', order: 0 },
            position: 'outlet',
            outletName: 'LoreOutlet',
          },
        ],
      }],
    };

    const ir = compilePromptGraph(document, {
      chatHistory: [{ role: 'user', content: 'Hello' }],
      worldbookEntries: [{ id: 'wb-outlet', content: 'Outlet lore', position: 'outlet', outletName: 'LoreOutlet' }],
      maxTokens: 256,
      reservedForReply: 32,
    });

    expect(ir.sections.find((section) => section.name === 'Worldbook Outlet LoreOutlet')).toMatchObject({ insertion: { kind: 'in_chat', depth: 1, order: 3 } });
  });

  it('adds continue nudge policy only for continue intent', () => {
    const document: PromptGraphDocument = {
      version: 1,
      rootGroupId: 'root',
      policies: { continueNudgePrompt: '[Continue now]' },
      groups: [{
        id: 'root',
        name: 'Root',
        edges: [],
        nodes: [{
          id: 'history-1',
          name: 'History',
          nodeType: 'chat_history',
          enabled: true,
          role: 'system',
          placement: { kind: 'relative', order: 0 },
        }],
      }],
    };

    const normalIr = compilePromptGraph(document, {
      chatHistory: [{ role: 'user', content: 'Hello' }],
      maxTokens: 256,
      reservedForReply: 32,
    });
    const continueIr = compilePromptGraph(document, {
      intent: 'continue',
      chatHistory: [{ role: 'user', content: 'Hello' }],
      maxTokens: 256,
      reservedForReply: 32,
    });

    expect(normalIr.sections.find((section) => section.name === 'continueNudge')).toBeUndefined();
    expect(continueIr.sections.at(-1)?.messages[0]?.content).toBe('[Continue now]');
  });

  it('applies names behavior to chat history and preserves in-chat insertion metadata', () => {
    const document: PromptGraphDocument = {
      version: 1,
      rootGroupId: 'root',
      policies: { namesBehavior: 'always' },
      groups: [{
        id: 'root',
        name: 'Root',
        edges: [],
        nodes: [
          {
            id: 'history-1',
            name: 'History',
            nodeType: 'chat_history',
            enabled: true,
            role: 'system',
            placement: { kind: 'relative', order: 0 },
          },
          {
            id: 'insert-1',
            name: 'Insert',
            nodeType: 'static_text',
            enabled: true,
            role: 'assistant',
            placement: { kind: 'in_chat', depth: 0, order: 3 },
            template: 'Continue speaking',
          },
        ],
      }],
    };

    const ir = compilePromptGraph(document, {
      character: { name: 'Knight' },
      persona: { name: 'Traveler' },
      chatHistory: [{ role: 'user', content: 'Hello' }],
      maxTokens: 256,
      reservedForReply: 32,
    });

    expect(ir.sections[0]?.semantic).toBe('chat_history');
    expect(ir.sections[0]?.messages[0]?.content).toBe('Traveler: Hello');
    expect(ir.sections[1]).toMatchObject({
      insertion: { kind: 'in_chat', depth: 0, order: 3 },
    });
    expect(ir.sections[1]?.messages[0]?.content).toBe('Knight: Continue speaking');
  });
});
