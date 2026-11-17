# Autodesk licensing: unattended Revit, and the alternative

## Why ask

Draft House runs Revit on one office computer with nobody at the keyboard: a worker picks up an approved design, pyRevit drives Revit to build the model, and the files go back to the client. The Autodesk subscription terms for desktop Revit are written for a named user at a screen. Before the service takes paying clients, Autodesk should say in writing whether this use is covered by the office's subscription, needs a different license, or is not allowed. The email below asks that.

## Email draft

To: your Autodesk account manager or reseller (or Autodesk Sales via autodesk.com/contact)
Subject: Revit subscription use for automated model generation at South Texas Builders

Hello,

South Texas Builders, LLC (McAllen, Texas) holds a Revit subscription under [account name / contract number] with [N] named users. I want to confirm that a planned use is covered before we put it in front of customers.

What we are building: a web service where a home buyer configures a floor plan from our standard styles. When a design is approved by one of our drafters, software on one office workstation launches Revit with our office template and builds the model from that design (walls, openings, rooms, roof, sheets), then exports an RVT, a PDF set and an IFC. Our drafters finish the drawings in Revit afterwards. The workstation is in our office, Revit is installed under a named user on our subscription, and the automation (pyRevit, which uses the Revit API) runs on that machine. No person sits at it while a model builds; a build takes a few minutes and we expect a handful per day. The output is used by our own drafters to produce construction drawings for our own customers' homes.

Questions:
1. Is this unattended, automated use of desktop Revit on one named-user seat allowed under our current subscription? If it depends on specifics (one machine, one named user, API use, volume), what are they?
2. If not, which license covers it: a Revit seat with specific terms, a Flex arrangement, or Autodesk Platform Services Design Automation for Revit? For Design Automation, what is the pricing basis (cloud credits per job) at a few builds per day?
3. Is there anything in the terms about the model files produced this way (for example, requirements on who opens or edits them) that we should know?

A written answer we can keep on file would be ideal. Happy to get on a call if that is easier.

Thank you,
[Name]
South Texas Builders, LLC
[phone] · [email]

## If the answer is no: Autodesk Platform Services, Design Automation for Revit

Design Automation runs Revit in Autodesk's cloud, headless, and bills per job. Nothing changes for the client or the drafters; only the worker changes.

What moves:

- **The build script** becomes a Revit add-in (C#, .NET) packaged as a Design Automation AppBundle. `build_model.py` is the specification for it: the same steps, the same design.json input, the same report.json output. Expect two to three weeks for a developer who knows the Revit API; the pyRevit script makes the port mechanical.
- **The worker** stops launching Revit and instead: uploads design.json and the office template to an OSS bucket, posts a WorkItem to the Design Automation API with the activity that pairs the AppBundle and the template, polls for completion, downloads model.rvt, sheets.pdf and model.ifc, and reports to the office API as it does today. That is a change to `draft_house_worker.py` only, and it can run on Render itself, so the office computer is no longer needed for building.
- **Setup** on the Autodesk side: an APS application (client id and secret), the AppBundle and Activity registered once per Revit version, the template uploaded once.
- **Cost**: Design Automation bills in cloud credits per WorkItem by processing time; at a few builds a day it is a small monthly amount. Confirm current pricing with Autodesk.
- **What is lost**: nothing for clients. The office keeps Revit for the drafters' finishing work exactly as now.

Order of work if this path is chosen: port the script to a C# add-in and test it in desktop Revit (same machine, same template), then register it with Design Automation, then switch the worker. The dashboard's manifold gets one more node, "Design Automation", with its own health check.
