# web-provable

A web browser extension for using and extending Kayros.

## Stack

- a Chrome extension
- a Safari extension
- ability to download (for example from github) in cache and run Wasm (WasmX modules)
- https://github.com/ark-us/wasmx
- ability to verify that all run code is unchanged
- ability to save in Google Drive the proofs

## Behavior

- present Markdown with input fields in the text
- calculate other read-only input fields based on the first
- ability to fetch/request from the internet
- ability to log an entry and get a proof from Kayros (via https://github.com/kuip/provable-sdk)
- has 2 themes: dark and light and the choice is done by the system
- a click on the icon opens a side pannel in the browser. Everything happens in that pannel.
- logo from static/images/logo.*

## Apps

In the dir apps/ we will have wasmX apps that extend the functionality

### Prove Inclusion

An app that:

- given:
  - a text A
  - a proof of A being notarized by Kayros
  - a text B
  - an integer N (optional): defaults to 0
- provides:
  - a search for B into A
  - counts C how many times B is found in A
  - returns True if N is less than C, False otherwise
  - ability to record the terms and the answer on Kayros (https://github.com/kuip/provable-sdk)
