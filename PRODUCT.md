# Stölk

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
SvelteKit served on localhost, SQLite on disk, local LLM run from Node for Ask and retrieval. Chosen by Ivan on 2026-11-19.

## Users
Ivan, one person, who organizes events and projects in Madrid and wants to remember who he met, where, and what he owes each person.

## Product Purpose
A personal CRM: contacts with history, how people relate (where you met, intros, co-attendance, who is likely at an event, inferred only from his own data), projects with per-person pending items, events he organizes that block his Cal.com, a calendar, local Ask, and "quedar con X" one-click message drafts carrying his Cal.com link.

## Positioning
Everything lives on his own computer. The only outbound calls are Cal.com sync and an opt-in Claude drafting tab that sends minimal context and shows exactly what it sends.

## Operating Context
Opened in a desktop browser at localhost on Linux; also usable at phone width. Messages go out through WhatsApp (wa.me), Telegram, Gmail and LinkedIn copy, always on Ivan's click. Scheduling lives in Cal.com.

## Capabilities and Constraints
- No LinkedIn scraping or automation; profile data is only what the person gave.
- Nothing is sent without Ivan's click.
- API keys (Cal.com, Anthropic) live only in a local gitignored .env.
- Claude (claude-opus-5-5) only for the Drafts tab; Ask and search stay local.
- Dropped: card scanning, .vcf/phone imports, GPS, Electron.

## Brand Commitments
- Name "Stölk". Monoline wordmark (tight spacing, eyes with big glint) stays.
- Everything else is simple black and white. Ivan pointed at Cal.com's app as the reference: near-black surfaces, thin borders, white primary button, Cal Sans headings.
- Eyes are never glaring; no surveillance imagery; consent first.

## Evidence on Hand
Brand assets in /mnt/project-files/brand/. Prototype data is sample data; no real contacts.

## Product Principles
1. Ivan's data stays on his machine.
2. One click to act, never zero clicks to send.
3. Remember for him; do not watch other people.
4. Quiet interface; the content is the people.
