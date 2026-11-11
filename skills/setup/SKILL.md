---
name: setup
description: Create or update the Seekwide project profile for a site (site URL, brand names, business model, markets, competitors, target queries, report branding), stored in .seekwide/profile.json in the current folder.
when_to_use: Use when the user starts auditing a new site or client, wants reports branded with their agency's name or logo, or wants to change the saved details of a project.
argument-hint: "[url]"
allowed-tools: mcp__plugin_seekwide_seekwide__profile_get, mcp__plugin_seekwide_seekwide__profile_set, mcp__plugin_seekwide_seekwide__runs_list
---

# Project setup

Create or update the profile of the site this folder is for. One folder holds one site: its profile, its audit runs and its reports all live in `.seekwide/` here, so an agency keeps one folder per client.

Arguments: `$ARGUMENTS` (optionally the site URL)

## Steps

1. Call `profile_get`.
   - If a profile exists, show it briefly and ask what to change.
   - If not, collect the details below.
2. Collect what the profile needs. Ask only for what you cannot work out, in one message, and accept "skip" for anything optional.
   - **Site URL** (required). Take it from the arguments when given.
   - **Brand name** (required), and other names the brand goes by.
   - **Business model**: one of `b2b_saas`, `ecommerce`, `local_service`, `publisher`, `mobile_app`, `international`, `other`.
   - **Markets**: country and languages for each, for example Turkey with Turkish.
   - **Competitors**: their domains.
   - **Target queries**: the searches the site most wants to be found for.
   - **Report branding**: the name to show as "Prepared by" on reports and the absolute path of a logo file (PNG, JPEG, WebP or SVG, 200 KB or less). This is the agency's brand, not the client's.
3. Call `profile_set` with the result. If it reports invalid fields, fix them with the user and call it again.
4. Tell the user what was saved and where, and what to do next: `/seekwide:basic <url>` for a quick audit or `/seekwide:all` for a full one.

## What to tell the user about the files

- Everything is stored in `.seekwide/` inside the current folder. The plugin puts a `.gitignore` there so client data is not committed by accident.
- This version uses two things from the profile: the site URL, as the default for `/seekwide:all`, and the report branding. The brand name and the other fields are stored for modules that are not in this version yet; filling them in now is optional.
- A logo set in the profile has to be a file inside this folder.
- No account or sign-in is needed. A Google API key is optional: with one, audits also measure Core Web Vitals (real-user data always needs it, and Google currently refuses lab tests without it). It is not part of the profile. The user sets it in Claude Code: `/plugin`, the Installed tab, Seekwide, "Configure options". Never ask for the key in the chat.
