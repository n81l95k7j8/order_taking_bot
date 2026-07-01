import { describe, it, expect } from 'vitest';
import { parseLaborXLink, containsLaborXLink } from './laborx';

describe('parseLaborXLink', () => {
  it('parses a gig link with id', () => {
    const r = parseLaborXLink('https://laborx.com/gigs/my-gig-id');
    expect(r).toEqual({ url: 'https://laborx.com/gigs/my-gig-id', type: 'gig', id: 'my-gig-id' });
  });

  it('parses a project link with id', () => {
    const r = parseLaborXLink('https://laborx.com/projects/abc123');
    expect(r).toEqual({ url: 'https://laborx.com/projects/abc123', type: 'project', id: 'abc123' });
  });

  it('parses a vacancy link with slug', () => {
    const r = parseLaborXLink('https://laborx.com/vacancies/senior-blockchain-engineer-for-rwahub-18621');
    expect(r).toEqual({
      url: 'https://laborx.com/vacancies/senior-blockchain-engineer-for-rwahub-18621',
      type: 'vacancy',
      id: 'senior-blockchain-engineer-for-rwahub-18621',
    });
  });

  it('parses a job link with slug', () => {
    const r = parseLaborXLink('https://laborx.com/jobs/blockchain-full-stack-developer-needed-solidity-react-web3-103351');
    expect(r).toEqual({
      url: 'https://laborx.com/jobs/blockchain-full-stack-developer-needed-solidity-react-web3-103351',
      type: 'job',
      id: 'blockchain-full-stack-developer-needed-solidity-react-web3-103351',
    });
  });

  it('parses a freelancer profile link', () => {
    const r = parseLaborXLink('https://laborx.com/freelancers/users/id451630');
    expect(r).toEqual({
      url: 'https://laborx.com/freelancers/users/id451630',
      type: 'profile',
      id: 'id451630',
    });
  });

  it('accepts a bare laborx.com link as a generic laborx url', () => {
    expect(parseLaborXLink('https://laborx.com')).toEqual({
      url: 'https://laborx.com',
      type: 'generic',
    });
  });

  it('accepts a laborx.com link with trailing slash as a generic laborx url', () => {
    expect(parseLaborXLink('https://laborx.com/')).toEqual({
      url: 'https://laborx.com/',
      type: 'generic',
    });
  });

  it('handles www. prefix', () => {
    const r = parseLaborXLink('https://www.laborx.com/gigs/x-1');
    expect(r?.type).toBe('gig');
    expect(r?.id).toBe('x-1');
  });

  it('handles http (not just https)', () => {
    const r = parseLaborXLink('http://laborx.com/gigs/x');
    expect(r?.type).toBe('gig');
  });

  it('extracts laborx link from surrounding text', () => {
    const r = parseLaborXLink('Hey, check this: https://laborx.com/gigs/x123 — looks good?');
    expect(r?.type).toBe('gig');
    expect(r?.id).toBe('x123');
  });

  it('returns null for non-laborx text', () => {
    expect(parseLaborXLink('just some random text')).toBeNull();
    expect(parseLaborXLink('https://example.com/foo')).toBeNull();
    expect(parseLaborXLink('')).toBeNull();
  });

  it('does not match similar domains', () => {
    expect(parseLaborXLink('https://laborx.org/gigs/x')).toBeNull();
    expect(parseLaborXLink('https://fakelaborx.com/gigs/x')).toBeNull();
  });

  it('prefers gig over generic when both could match', () => {
    const r = parseLaborXLink('https://laborx.com/gigs/specific');
    expect(r?.type).toBe('gig');
  });

  it('supports uppercase domain letters', () => {
    const r = parseLaborXLink('https://LaborX.com/projects/abc123');
    expect(r?.type).toBe('project');
  });
});

describe('containsLaborXLink', () => {
  it('returns true for laborx task urls and generic domain mentions', () => {
    expect(containsLaborXLink('https://laborx.com')).toBe(true);
    expect(containsLaborXLink('https://laborx.com/')).toBe(true);
    expect(containsLaborXLink('https://laborx.com/gigs/x')).toBe(true);
    expect(containsLaborXLink('https://laborx.com/jobs/x')).toBe(true);
    expect(containsLaborXLink('https://laborx.com/freelancers/users/id451630')).toBe(true);
    expect(containsLaborXLink('text before https://www.laborx.com/projects/y trailing')).toBe(true);
  });

  it('returns false for non-laborx text', () => {
    expect(containsLaborXLink('https://example.com')).toBe(false);
    expect(containsLaborXLink('')).toBe(false);
  });
});
