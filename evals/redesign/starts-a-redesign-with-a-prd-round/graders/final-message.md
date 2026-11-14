---
type: llm
weight: 2
---
This is the agent's last message after being asked to rebuild a small reading-list app from the
ground up, with the person going over each step before the next begins. Score 1 only if the
message (a) gives a local web address of the form http://127.0.0.1:<port>/... for a page the
person should open, (b) says how the person finishes (pressing a Finish button on that page, or
telling the agent they are done), and (c) does not present specs, wireframes, a proposed
architecture, a technology choice or a build plan as work done or about to start. A short
description of what the page contains, assumptions the agent recorded, and caveats about the
environment (such as a browser that could not launch) are all fine and do not lower the score.
Score 0 if there is no local address, if the message proceeds past requirements into design or
build, or if it requires the person to answer questions in the chat before the page can be
looked at.
