# Zeroid — Original Vision Document (source)

Status: reference only. Kept verbatim as the product/feature source of truth
— the body below still says "Lead AI" throughout because that was this
product's working name when it was written; the product was renamed to
**Zeroids** and then, same day, corrected to **Zeroid** (2026-08-30; intended
domain: `zeroid.net`, not yet registered). Deliberately not renamed inside
the body text below — this
file exists specifically to preserve what was originally handed over,
unmodified. Where this doc and `build-spec.md` disagree on architecture,
scope, or naming, `build-spec.md` wins — see its §2 for the specific
alterations and why.

---

# **LEAD AI**
## **AI Powered Lead Generation, Qualification and Sales Automation SaaS**
### **Master Product Design and Technical Specification**

**Document Status:** Build Specification
**Working Product Name:** Lead AI
**Product Type:** Multi tenant SaaS
**Primary Objective:** Generate, qualify, nurture and develop sales leads using AI across organic and paid acquisition channels.

---

# **1. PRODUCT VISION**

Lead AI is a SaaS platform that acts as an **AI powered sales development department** for businesses.

A business owner should be able to create a business inside Lead AI, teach the system about that business, define or allow AI to discover its ideal customers, connect its marketing channels and then allow Lead AI to continuously:

**Research → Attract → Find → Engage → Qualify → Score → Nurture → Book → Handover → Follow Up → Analyse → Learn**

Lead AI must support both:

**Organic lead generation**
and
**Paid advertising**

Both acquisition channels must feed into the same central lead intelligence, CRM, AI conversation and follow up infrastructure.

The system must not be designed around one business or industry.

A customer should be able to operate multiple businesses from one Lead AI account.

---

# **2. CORE PRODUCT PHILOSOPHY**

Lead AI should follow five principles.

### **Teach it**
The business owner teaches the AI about the company.

### **Deploy it**
The AI uses that knowledge to perform lead generation and sales development tasks.

### **Measure it**
The system measures what produces leads, qualified leads, appointments and revenue.

### **Learn from it**
AI analyses outcomes and discovers patterns.

### **Improve it**
AI recommends or, where authorised, implements improvements.

The goal is not merely to produce more leads.

The goal is:

> **Generate more qualified opportunities and ultimately more revenue.**

---

# **3. TARGET USERS**

Lead AI should support:

### **Individual users**
Coaches, Consultants, Entrepreneurs, Freelancers, Sales professionals, Real estate agents, Network marketing professionals, Small business owners

### **Teams**
Sales teams, Marketing teams, Agencies, Training companies, Real estate companies, Professional service firms, SMEs

### **Larger organisations**
Multiple departments, Multiple sales teams, Multiple brands, Franchises, Enterprise sales organisations

---

# **4. MULTI TENANT SAAS MODEL**

```text
Platform
    |
    Organisation / Account
        |
        ├── Users
        |
        ├── Businesses
        |      |
        |      ├── Products
        |      ├── Services
        |      ├── ICPs
        |      ├── Knowledge Base
        |      ├── Campaigns
        |      ├── Leads
        |      ├── Conversations
        |      └── AI Configuration
        |
        ├── Subscription
        |
        └── Usage
```

One account can own multiple businesses. Each business must have its own
independent AI context. Business A must never contaminate Business B's AI
knowledge.

---

# **5. USER TYPES**

Owner, Administrator, Manager, Salesperson, Marketing User, Viewer. Enterprise
versions should support custom roles later.

---

# **6. SUBSCRIPTION TIERS**

| Plan       |  Users | Businesses | Leads/month |
| ---------- | -----: | ---------: | ----------: |
| Solo       |      1 |          1 |       2,500 |
| Pro        |      1 |          3 |      10,000 |
| Team       |      5 |          5 |      50,000 |
| Business   |     15 |         10 |     150,000 |
| Enterprise | Custom |     Custom |    500,000+ |

Lead limits should be soft limits: notify, display usage, offer additional
capacity, offer upgrade, never unexpectedly terminate active conversations.

---

# **7. AI CREDIT SYSTEM**

Internal usage currency: AI Credits.

| Action                        | Suggested credits |
| ----------------------------- | ----------------: |
| Basic AI generation           |                 1 |
| Lead classification           |                 1 |
| Lead scoring                  |                 1 |
| AI qualification conversation |                 5 |
| Prospect research             |                10 |
| Conversation analysis         |                10 |
| Campaign generation           |                20 |
| Deep market research          |               20+ |

Configurable by administrators. Customers can purchase additional credits.

---

# **8. AI MODEL ABSTRACTION**

```text
LeadAI AI Service
       |
       ├── OpenAI
       ├── Claude
       ├── Kimi
       └── Future providers
```

Internal functions: `generate()`, `analyse()`, `classify()`, `research()`,
`score()`, `summarise()`, `extract()`, `embed()`. Routing layer decides which
model handles a task. Admins configure default/premium/low-cost/fallback
models. Provider used should be invisible to normal users unless model
selection is exposed as a feature.

---

# **9. BUSINESS ONBOARDING**

Onboarding wizard questions: What is your business called? What do you sell?
Who buys from you? What problem do you solve? What makes you different? How
much does your product cost? Where do you currently get customers? What
countries or locations do you serve? What questions do prospects usually ask?
What objections do prospects usually raise? What should the AI never say or
promise?

AI transforms answers into structured business intelligence.

---

# **10. TRAIN YOUR AI**

Users train Lead AI using: text instructions, documents, PDFs, Word files,
presentations, URLs, website content, FAQs, product information,
testimonials, case studies, sales scripts, training manuals, previous sales
conversations. Processed into a searchable business knowledge base.

---

# **11. AI INSTRUCTIONS**

Permanent instructions, e.g. "Never offer discounts without approval," "Always
explain value before discussing price," "Do not make income guarantees."
Fields: Name, Content, Priority, Status, Business association, Created by,
Created date, Updated date.

---

# **12. BUSINESS KNOWLEDGE ARCHITECTURE**

Business Knowledge, Product Knowledge, Customer Knowledge, Sales Knowledge,
Objection Knowledge, Brand Knowledge, Compliance Knowledge.

---

# **13. IDEAL CUSTOMER PROFILE ENGINE**

Manual ICP definition: age, gender where relevant, location, profession,
industry, income, business revenue, company size, interests, problems, goals,
buying behaviour, budget, urgency, decision making authority. AI turns these
into a structured ICP.

---

# **14. AI DISCOVERED ICP**

"Discover my ideal customers" analyses existing customers, successful/lost
deals, lead sources, conversation history, purchase history, conversion
rates, then recommends ICP characteristics. User can accept/reject/modify.

---

# **15. DYNAMIC ICP**

System continuously compares predicted vs. actual customer. AI never silently
redefines targeting — recommendations require approval unless autonomous
optimisation is explicitly enabled.

---

# **16. ORGANIC LEAD GENERATION ENGINE**

Research Agent (finds topics/questions/discussions), Content Agent (social
posts, articles, video scripts, short form, email, WhatsApp, lead magnets),
Engagement Agent (finds engagement opportunities), Distribution Agent
(publishes through connected channels). Must not spam indiscriminately.

---

# **17. CONTENT STRATEGY**

Content tied to ICP, purpose-tagged: Awareness, Problem identification,
Education, Authority, Trust, Objection handling, Lead capture, Conversion. AI
explains why it created a piece of content.

---

# **18. PAID ADVERTISING ENGINE**

Campaign creation, audience strategy, creative/copy/headline/CTA generation,
landing page strategy, testing, performance analysis. User defines product,
offer, target market, location, budget, objective. Users approve campaigns
before publication unless autonomous advertising is explicitly enabled.

---

# **19. AD CREATIVE TESTING**

Variations: problem angle, desire angle, curiosity angle, authority angle,
social proof, fear of loss, educational, comparison. Optimise for cost per
qualified lead / appointment / customer / revenue generated, not clicks.

---

# **20. PROSPECTING ENGINE**

User defines target market, location, industry, company size, job role, other
ICP characteristics. System produces prospect records where permitted, each
with a confidence/fit score. Do not design around scraping restricted
platforms or bypassing platform controls.

---

# **21. LEAD CAPTURE**

Website forms, landing pages, Facebook, Instagram, WhatsApp, Email, Google,
TikTok, LinkedIn, manual entry, CSV import, API, referrals. Every lead gets:
Lead ID, Business ID, Source, Campaign, Date created, Current status.

---

# **22. UNIVERSAL LEAD PROFILE**

Example:

```text
Name: John Ade
Source: Facebook
Campaign: Sales Mastery
Location: Lagos
ICP Score: 91
Problem: Inconsistent customer acquisition
Desired outcome: 20 new clients monthly
Budget: ₦150,000+
Urgency: High
Lead score: 88
Status: HOT
Assigned salesperson: David
Next action: Call prospect
```

---

# **23. AI CONVERSATION ENGINE**

AI must be context aware: business, product, prospect, prior messages,
questions already asked, objections, current stage. Avoid repetitive
questions.

---

# **24. QUALIFICATION FRAMEWORK**

Problem, Need, Desire, Urgency, Budget, Authority, Fit. Exact questions
dynamically generated by AI.

---

# **25. LEAD SCORING**

| Factor             |  Points |
| ------------------ | ------: |
| ICP fit            |      15 |
| Problem severity   |      20 |
| Purchase intent    |      20 |
| Budget fit         |      15 |
| Urgency            |      15 |
| Engagement         |      10 |
| Decision authority |       5 |
| **Total**          | **100** |

80–100: HOT, 60–79: WARM, 0–59: COLD. Admin-customisable.

---

# **26. CRM**

Pipeline: New → Contacted → Engaged → Qualified → Hot → Appointment →
Proposal → Negotiation → Won / Lost / Nurture. Custom stages must be
supported.

---

# **27. HUMAN HANDOVER**

Salesperson receives: lead profile, conversation summary, pain points,
desired outcome, objections, budget, urgency, lead score, recommended next
action, suggested opening message. Never start from zero.

---

# **28. FOLLOW UP ENGINE**

Automated sequences per situation: Thinking about it, Too expensive, Needs
approval, Not ready, Comparing alternatives, Interested but busy, No
response. Channels: WhatsApp, Email, SMS, Tasks, Calls, Content, AI
personalised messages.

---

# **29. AI FOLLOW UP PERSONALISATION**

Uses conversation context rather than generic check-ins. Respect frequency
limits; user controls communication cadence.

---

# **30. APPOINTMENT SYSTEM**

Calendar integration: offer times, book, reschedule, cancel, reminders,
notify salesperson, update CRM, record outcome.

---

# **31. REFERRAL ENGINE**

Requests referrals after a successful purchase/positive interaction, timing
configurable, tracked separately.

---

# **32. AI SALES INTELLIGENCE**

Analyses aggregate data: top lead sources, best campaigns, best ICPs, common
objections/buying signals, salesperson performance, conversion bottlenecks,
follow up failures, revenue patterns.

---

# **33. DAILY AI BRIEFING**

Example: "147 new leads yesterday. 32 qualified. 11 became hot. 7 appointments
booked. 3 deals won. Campaign B generated the highest number of qualified
leads. 18 hot prospects require follow up today."

---

# **34. DASHBOARD**

Leads, Qualified leads, Hot leads, Appointments, Deals, Revenue, Organic
leads, Paid leads, Cost per lead, Cost per qualified lead, CAC, Conversion
rate, Pipeline value, AI usage, AI cost estimate.

---

# **35. ATTRIBUTION**

```text
Source: Facebook
Campaign: Campaign 7
Ad: Video Hook 3
Landing page: Sales Mastery
First touch: Facebook
Last touch: WhatsApp
Conversion: Purchase
```

Support first touch, last touch, multi touch (later) attribution.

---

# **36. AI LEARNING ENGINE**

Learns from leads, conversations, campaigns, appointments, deals, lost
opportunities, customer behaviour, referrals. Identifies what converts, what
messages work, what blocks conversion, best channels/campaigns, best
salesperson-lead-type fit.

---

# **37. HUMAN CONTROL**

AI Suggest (recommends), AI Assist (prepares for approval), AI Automate
(executes predefined workflows), AI Autopilot (executes approved action
categories automatically). Lets customers gradually increase automation.

---

# **38. NOTIFICATION SYSTEM**

New hot/qualified leads, appointments, missed follow ups, campaign problems,
usage limits, AI errors, sales milestones, important AI insights.

---

# **39. INTEGRATIONS**

Initial priority: WhatsApp, Meta, Email, Google Calendar, Webhooks, CSV.
Later: TikTok, LinkedIn, Google Ads, Zapier, Make, payment platforms, CRM
integrations.

---

# **40. WHATSAPP**

```text
Advertisement → WhatsApp → Lead AI → AI Conversation → Qualification → CRM → Human Salesperson
```

Use official APIs, comply with WhatsApp business messaging rules.

---

# **41. SECURITY**

Tenant isolation, role based permissions, encrypted credentials, secure
authentication, password hashing, session security, API authentication, rate
limiting, audit logs, data backups, secure file storage, encryption at rest
and in transit, data deletion, user export, consent management.

---

# **42. AI DATA ISOLATION**

```text
Organisation A -> Business A -> Knowledge A, Leads A
Organisation B -> Business B -> Knowledge B, Leads B
```

No retrieval operation should access another tenant's data. Use business and
organisation identifiers throughout database queries and vector retrieval.

---

# **43. DATABASE**

Recommended initial entities: users, organisations, organisation_members,
businesses, products, services, knowledge_sources, knowledge_documents,
knowledge_chunks, ai_instructions, icp_profiles, campaigns,
campaign_variants, ad_accounts, ad_creatives, lead_sources, leads,
lead_events, lead_scores, conversations, messages, appointments,
sales_opportunities, deals, customers, follow_up_sequences,
follow_up_messages, tasks, referrals, analytics, ai_runs, ai_usage,
integrations, subscriptions, subscription_items, usage_records,
notifications, audit_logs. All tenant-sensitive entities must include
appropriate organisation/business ownership references.

---

# **44. API DESIGN**

REST initially. Examples:

```text
POST /api/auth/login
GET /api/businesses
POST /api/businesses
GET /api/businesses/:id
POST /api/businesses/:id/train
GET /api/businesses/:id/knowledge
POST /api/icp
GET /api/leads
POST /api/leads
GET /api/leads/:id
POST /api/leads/:id/score
GET /api/conversations
POST /api/conversations
POST /api/campaigns
POST /api/campaigns/:id/generate
GET /api/analytics
GET /api/usage
```

All routes must enforce authentication and tenant authorisation.

---

# **45. BACKGROUND JOB SYSTEM**

Redis + workers for: document processing, embedding generation, AI analysis,
lead scoring, follow up scheduling, campaign analysis, content generation,
analytics aggregation, notifications, webhook processing, AI research.

---

# **46. FRONTEND**

Next.js, TypeScript, Tailwind CSS. Primary navigation: Dashboard, Businesses,
Leads, Conversations, Campaigns, Content, Prospecting, CRM, Follow Up,
Appointments, Analytics, Train Your AI, Integrations, Team, Billing,
Settings.

---

# **47. BUSINESS SWITCHER**

Changing business changes: leads, campaigns, AI knowledge, products, ICP,
conversations, analytics, business-specific integrations.

---

# **48. ONBOARDING UX**

Create account → Create business → Tell Lead AI about your business → Define
or discover ideal customer → Add product → Connect channels → Choose
organic/paid/both → Review AI generated strategy → Launch.

---

# **49–52. PHASED BUILD**

**MVP Phase 1:** Authentication, multi tenant architecture, business
creation, product/service management, Train Your AI, knowledge base, ICP
builder, lead capture, AI qualification, lead scoring, CRM, AI follow up,
WhatsApp, basic analytics, subscription management, AI credit tracking.

**Phase 2:** Organic content engine, prospecting, lead magnets, appointment
booking, referral engine, advanced analytics, email automation, team
management.

**Phase 3:** Paid advertising integrations, campaign creation, creative
generation, campaign optimisation, advanced attribution, revenue analytics,
predictive lead scoring, AI sales intelligence.

**Phase 4:** AI Autopilot, advanced autonomous prospecting, advanced campaign
optimisation, predictive revenue forecasting, advanced enterprise controls,
white labelling, custom AI agents, enterprise integrations.

---

# **53. CORE AI AGENTS**

Business Intelligence Agent, ICP Agent, Research Agent, Content Agent,
Advertising Agent, Prospecting Agent, Conversation Agent, Qualification
Agent, Follow Up Agent, Sales Intelligence Agent, Learning Agent, Orchestrator
Agent.

---

# **54. AI PROMPT ARCHITECTURE**

```text
System Rules + Business Context + Product Context + ICP Context +
Conversation Context + Lead Context + Current Task + Compliance Rules +
Output Format
```

---

# **55. AI MEMORY**

Permanent Business Memory, Customer Memory, Conversation Memory, Campaign
Memory, Analytical Memory. Do not mix indiscriminately.

---

# **56. AUTONOMOUS ACTION SAFETY**

Actions requiring explicit approval by default: launching ads, changing ad
budgets, offering discounts, financial promises, mass communications,
deleting records, changing pricing. User can explicitly authorise specific
autonomous actions later.

---

# **57. BILLING**

Subscription plans (monthly/annual), upgrades/downgrades, usage charges, AI
credit purchases, additional users/businesses/lead capacity, invoices,
payment history, subscription status. Use a payment abstraction layer for
multiple providers.

---

# **58. USAGE MONITORING**

Monthly leads used/allowance, AI credits used/remaining, messages sent, AI
conversations, storage, connected channels, users, businesses.

---

# **59. ADMIN CONSOLE**

Customer management, subscription management, AI provider configuration,
model routing, usage monitoring, system health, AI cost monitoring, feature
flags, plan configuration, credit pricing, lead limits, audit logs, support
tools, integration status.

---

# **60. AI COST DASHBOARD**

AI spend by customer/business/model/task, cost per lead, cost per
conversation, average AI cost per customer, revenue vs. AI cost.

---

# **61. ANALYTICS EVENTS**

`lead_created, lead_qualified, lead_scored, lead_contacted, lead_replied,
lead_became_hot, appointment_booked, appointment_completed, deal_created,
deal_won, deal_lost, followup_sent, content_published, campaign_created,
campaign_launched, campaign_paused, subscription_created, credit_consumed`

---

# **62. PERFORMANCE METRICS**

Lead, Qualified Lead, Hot Lead, Opportunity, Customer — distinct definitions
to prevent vanity metrics.

---

# **63. NORTH STAR METRIC**

**Revenue Generated Per 1,000 Leads.** Secondary: qualified lead rate, hot
lead rate, appointment rate, closing rate, CAC, revenue per lead, lead
response time, follow up conversion.

---

# **64. THE COMPLETE SYSTEM**

```text
                    LEAD AI
                       |
       ┌───────────────┴────────────────┐
       |                                |
 ORGANIC ENGINE                   PAID ENGINE
       |                                |
 Content                         Advertising
 SEO                             Campaigns
 Engagement                      Creatives
 Prospecting                     Optimisation
       |                                |
       └───────────────┬────────────────┘
                       |
                  LEAD CAPTURE
                       |
                AI CONVERSATION
                       |
                 QUALIFICATION
                       |
                  LEAD SCORING
                       |
          ┌────────────┼────────────┐
          |            |            |
         HOT          WARM         COLD
          |            |            |
      Sales Team      Nurture      Nurture
          |            |            |
          └────────────┼────────────┘
                       |
                     CRM
                       |
                    DEALS
                       |
                   CUSTOMERS
                       |
                   REFERRALS
                       |
                 MORE LEADS
                       |
                  LEARNING AI
                       |
                 OPTIMISATION
                       |
                    REPEAT
```

---

# **65. THE MOST IMPORTANT DIFFERENTIATOR**

Not another CRM with a chatbot attached. The customer teaches Lead AI their
business. Lead AI learns who buys, identifies opportunities, creates
acquisition strategies, generates/discovers prospects, starts conversations,
qualifies, nurtures, alerts salespeople, analyses outcomes, learns. The next
campaign becomes smarter. That closed learning loop is the heart of the
architecture.

---

# **66. INSTRUCTIONS TO CLAUDE FOR DEVELOPMENT (original)**

Build Lead AI as a production ready multi tenant SaaS application, not a
prototype. Establish a clean modular architecture before implementing major
features so AI providers, communication channels, advertising platforms and
business types can be added without rewriting the core system. Prioritise
security, tenant isolation, scalability, observability, maintainability and
cost control. Do not hard code business specific assumptions — every business
has its own AI context, knowledge base, products, ICPs, campaigns, leads,
conversations, configuration. Implement role based permissions and usage
metering / AI credit tracking from the beginning. Build the AI layer behind
an abstraction interface. Use background workers for long running
operations. Do not implement autonomous actions with financial, legal or
reputational risk without explicit user authorisation. Build the MVP first,
architected so Phase 2–4 don't require rewrites. Every major feature needs
models, endpoints, screens, validation, error handling, logging, permission
checks — implement actual functionality, not just UI. When a requirement is
ambiguous, choose the architecture that preserves scalability, tenant
isolation and extensibility, and document the decision.

---

# **67. DEVELOPMENT ORDER (original)**

1. Project foundation, authentication, multi tenancy
2. Organisation, user roles, business workspaces
3. Products, services, business configuration
4. Train Your AI and knowledge base
5. AI abstraction and model routing
6. ICP engine
7. Lead management and CRM
8. AI conversation and qualification
9. Lead scoring
10. WhatsApp integration
11. AI follow up
12. Analytics and AI sales intelligence
13. Subscription, lead limits, AI credits
14. Organic lead generation
15. Prospecting
16. Paid advertising
17. Advanced automation and AI Autopilot

Do not build advertising automation before the underlying lead, AI, CRM,
attribution and usage infrastructure is solid.

---

# **68. THE PRODUCT IN ONE SENTENCE**

> Lead AI is a multi tenant SaaS platform that allows businesses to train
> their own AI sales department, which then uses organic and paid
> acquisition channels to find, attract, engage, qualify, nurture and
> develop prospects while continuously learning from sales outcomes.

---

# ADDENDUM: INTEGRATION SUITE

Lead AI should have an Integrations Centre where users can connect all
supported platforms.

**Communication and Messaging:** WhatsApp Business, Email, SMS
**Social Media and Organic Acquisition:** Facebook, Instagram, LinkedIn, TikTok
**Paid Advertising:** Meta Ads, Google Ads, TikTok Ads, LinkedIn Ads
**Search and Web:** Google, Website, Landing pages, Web forms
**Calendar and Meetings:** Google Calendar, Microsoft Outlook Calendar, Zoom
**Automation:** Zapier, Make, Webhooks
**Data:** CSV import/export, API
**Payments:** Paystack, Flutterwave, Stripe, others via a payment abstraction layer
**CRM:** External CRM integrations (HubSpot, Salesforce, etc. without changing Lead AI core)

## Architecture

Do not allow individual features to directly communicate with individual
integrations. Create an Integration Layer:

```text
                         LEAD AI
                            |
                    Integration Layer
                            |
       ┌──────────┬─────────┼──────────┬──────────┐
       |          |         |          |          |
   Messaging   Social     Ads       Calendar   Payments
       |          |         |          |          |
   WhatsApp    Meta      Google      Google     Stripe
   Email       Instagram Meta Ads    Outlook    Paystack
   SMS         LinkedIn  TikTok Ads  Zoom       Flutterwave
               TikTok    LinkedIn
```

Core Lead AI doesn't care whether a lead came from Facebook, TikTok, Google,
WhatsApp or a website — it receives Lead, Source, Campaign, Contact
information, Interaction history, Attribution.

## Integration standard

Common interface: `connect(), disconnect(), authenticate(), refreshToken(),
getAccount(), getContacts(), createLead(), updateLead(), sendMessage(),
receiveMessage(), createCampaign(), getCampaign(), getAnalytics(),
handleWebhook()`. Not every platform supports every function — each
integration declares its capabilities (e.g. WhatsApp: send/receive
message, webhooks, contact management, no advertising; Meta Ads: campaign
creation/management/analytics, lead forms, webhooks).

## Integration Centre UX

Connected / Available lists, each integration has: Connect, Configure, Test
Connection, Reconnect, Disconnect, View permissions.

## Unified Lead Timeline

All interactions across channels appear in one timeline per lead, e.g.
Facebook Ad → Lead Form → WhatsApp conversation → AI qualification → Lead
score → Email → Appointment booked → Zoom meeting → Deal created → Payment
received → Customer.

## Integration driven automation

Example rules:

- WHEN someone submits a Facebook lead form THEN create lead, score it, send
  WhatsApp message, start qualification, notify salesperson if score > 80
- WHEN a lead becomes HOT THEN create CRM opportunity, notify salesperson,
  offer appointment
- WHEN appointment is booked THEN create calendar event, send confirmation,
  schedule reminder, update CRM
- WHEN payment is received THEN change lead to CUSTOMER, stop sales
  follow-ups, start onboarding sequence, schedule referral request

## Integration Marketplace (future)

Categories: Messaging, Advertising, Social, CRM, Payments, Calendar,
Meetings, Automation, Analytics, Data — added continuously without changing
the core architecture.

## Critical build instruction (original)

Architecture must support all integrations defined in the Integration Suite
from the beginning. Integrations may be implemented progressively, but the
database, integration abstraction layer, authentication architecture,
webhook architecture, event system and automation engine must be designed
from the beginning to support all listed integrations without architectural
restructuring. Do not build isolated one-off integrations — build a reusable
integration framework. Every integration must implement the appropriate
capabilities through a common interface. Credentials must be securely
stored, OAuth tokens encrypted, token refresh automated where applicable,
webhook events normalised into Lead AI events, integration failures logged
and retried through background workers.
