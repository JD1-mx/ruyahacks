# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

Hackathon project: **Self-improving AI agent for logistics/freight forwarding companies**. Time-constrained — optimize for working demo over polish.

### Problem
Freight forwarders juggle emails, phone calls, and WhatsApp messages to coordinate container movements. The agent handles all inbound/outbound communication across channels and **self-creates tools it doesn't yet have** when a customer requests a new channel or capability.

### Core Flow
Moving containers from **Jebel Ali port** to warehouses across Dubai. The agent:
1. Uses **BAPI** for AI voice orchestration and phone calls
2. Handles email and WhatsApp communication
3. Escalates to human operators (via internal WhatsApp) when something breaks or is unknown
4. **Self-creates new tools** on BAPI and new workflows when it encounters a capability gap (e.g., customer asks for WhatsApp contact but no WhatsApp tool exists yet)

### Self-Improving Behavior
When the agent can't fulfill a request, it:
- Notifies the operator: "I'm building a new tool to handle this"
- Creates the tool/workflow dynamically
- Logs what it learned for future requests

## Hackathon Judging Criteria (prioritized by weight)

| Priority | Criteria | Weight | Focus |
|----------|----------|--------|-------|
| **HIGH** | Completion & Demo Readiness | 20% | Working prototype, complete demo flow |
| **HIGH** | Output Quality and Technique | 20% | Actually solves the logistics task |
| **MED** | Staying on Topic (self-improving agents) | 15% | Show the self-tool-creation loop |
| **MED** | Innovation & Originality | 15% | Beyond generic chatbot — show autonomous tool creation |
| LOW | Usage of Provided Services/APIs | 10% | Use BAPI and provided infra |
| LOW | Scalability & Feasibility | 10% | Show it could scale commercially |
| LOW | Presentation | 10% | Clear problem/solution articulation |

## Engineering Philosophy

Write code like Jared Sumner and review it like Will Larson.

### Code Style
- Simple > clever. If a junior can't read it, rewrite it.
- Delete code aggressively. The best code is no code.
- No abstractions until you need them three times.
- Functions do one thing. If you're writing "and" in the description, split it.
- Fail fast and loud. Silent failures are bugs.

### System Design
- Think about failure modes first. What breaks at 3am?
- No distributed transactions. Design for partial failure.
- Complexity is debt. Every abstraction has carrying cost.
- Ship fast, fix forward. Perfect is the enemy of deployed.

### What I Don't Want
- Over-engineering for hypothetical futures
- Premature optimization without profiling
- Comments that restate the code
- Defensive programming against impossible states
- Bikeshedding on style when logic is wrong


Hackathon Rules:

Hackathon FAQ – Participants Guide

⚪ 1. Do I need to bring my own laptop?

Yes. All participants must bring their own laptop, charger, and any required accessories.

⚪ 2. Will internet/Wi-Fi be provided?

Yes, high-speed Wi-Fi will be available at the venue. However, we recommend having a mobile hotspot as backup. Check ⁠👋-welcome for info on the Wi-Fi.

⚪ 3. Can we use cloud services or APIs?

Yes. Teams are free to use cloud services, APIs, open-source tools, and frameworks unless explicitly restricted.
⚪ 4. Can we use ChatGPT or other AI tools?

Yes. AI tools are allowed, but judges will evaluate how effectively you use them, not just output quality.

⚪ 5. Can we use pre-built code or previous projects?

You may use existing libraries or frameworks, but core solution logic should be developed during the hackathon.

⚪ 6. How many people per team?

Teams should follow the event rule (usually 2–5 members). Solo participation depends on organizer approval.

⚪ 7. How will submissions work?

Teams will submit:
• Demo or running solution
• Code repository link
• Short documentation or presentation

Submission instructions will be shared on Discord.

⚪ 8. What happens during judging?

• 3-minute demo
• Minimal slides (optional)
• Judges ask quick questions
Focus on showing the solution working.

⚪ 9. What if Wi-Fi fails during demo?

Teams should prepare an offline fallback demo (recorded or local run).

⚪ 10. Are food and refreshments provided?

Yes, meals and refreshments will be available during the event.

⚪ 11. Can we leave and come back?

Yes, but at least one team member should remain reachable during key sessions.

⚪ 12. Can we recruit or be recruited?
Yes. This hackathon may lead to hiring opportunities or incubation support.

⚪ 13. Where do we ask questions?
Use the Discord help channels or approach event mentors. 

⚪ 14. What should we prepare before arriving?

Recommended:
• Development environment setup
• Required libraries/tools installed
• GitHub account ready
• API keys if needed