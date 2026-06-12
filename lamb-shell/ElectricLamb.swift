import AppKit
import Carbon.HIToolbox
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverProcess: Process?
    private var serverOutput = Data()
    private var didLoadServer = false
    private var hotKeyRefs: [EventHotKeyRef?] = []
    private var serverStartError = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        registerHotKeys()
        startServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
        unregisterHotKeys()
    }

    func windowWillClose(_ notification: Notification) {
        stopServer()
        unregisterHotKeys()
        NSApplication.shared.terminate(nil)
    }

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.autoresizingMask = [.width, .height]

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 920, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 720, height: 520)
        window.center()
        window.title = "Electric Lamb"
        window.delegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
    }

    private func startServer() {
        guard let appRoot = Bundle.main.resourceURL?.appendingPathComponent("app") else {
            showError("Missing bundled app resources.")
            return
        }

        let script = appRoot.appendingPathComponent("scripts/lamb-server.js")
        let node = findNodeExecutable()
        guard let node else {
            showMissingNodeError()
            return
        }

        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        process.executableURL = node
        process.arguments = [script.path]
        process.currentDirectoryURL = appRoot
        process.standardOutput = stdout
        process.standardError = stderr

        var environment = ProcessInfo.processInfo.environment
        environment["ELECTRIC_LAMB_OPEN"] = "0"
        environment["ELECTRIC_LAMB_PORT"] = "0"
        environment["ELECTRIC_LAMB_PARENT_PID"] = String(getpid())
        process.environment = environment
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            self?.handleServerOutput(handle.availableData)
        }
        stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            self?.handleServerOutput(handle.availableData)
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.didLoadServer else { return }
                let detail = self.serverStartError.isEmpty ? "" : "\n\nBackend output:\n\(self.serverStartError)"
                self.showError("Electric Lamb backend stopped before it was ready.\(detail)")
            }
        }

        do {
            try process.run()
            serverProcess = process
        } catch {
            showError("Could not start Electric Lamb with Node.js at \(node.path).\n\n\(error.localizedDescription)")
        }
    }

    private func stopServer() {
        serverProcess?.terminate()
        serverProcess = nil
    }

    private func registerHotKeys() {
        let signature = OSType(0x454C414D) // ELAM
        let modifiers = UInt32(cmdKey | shiftKey)
        let hotKeys: [(UInt32, UInt32)] = [
            (UInt32(kVK_ANSI_B), 1),
            (UInt32(kVK_ANSI_S), 2)
        ]
        var eventSpec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))

        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let event, let userData else { return noErr }
            var hotKeyID = EventHotKeyID()
            let status = GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &hotKeyID
            )
            guard status == noErr else { return status }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async {
                delegate.handleHotKey(hotKeyID.id)
            }
            return noErr
        }, 1, &eventSpec, Unmanaged.passUnretained(self).toOpaque(), nil)

        for (keyCode, id) in hotKeys {
            var hotKeyRef: EventHotKeyRef?
            let hotKeyID = EventHotKeyID(signature: signature, id: id)
            if RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef) == noErr {
                hotKeyRefs.append(hotKeyRef)
            }
        }
    }

    private func unregisterHotKeys() {
        for hotKeyRef in hotKeyRefs {
            if let hotKeyRef {
                UnregisterEventHotKey(hotKeyRef)
            }
        }
        hotKeyRefs.removeAll()
    }

    private func handleHotKey(_ id: UInt32) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)

        if id == 1 {
            webView.evaluateJavaScript("""
            fetch('/api/clipboard-content')
              .then(response => response.json())
              .then(content => window.electricSheep?.__emitClipboardCaptured?.(content));
            """)
        }

        if id == 2 {
            webView.evaluateJavaScript("""
            Promise.all([
              fetch('/api/clipboard-content').then(response => response.json()),
              fetch('/api/screenshot', { method: 'POST' }).then(response => response.json())
            ]).then(([content, screenshot]) => {
              window.electricSheep?.__emitClipboardCaptured?.(content);
              window.electricSheep?.__emitScreenshotCaptured?.(screenshot);
            });
            """)
        }
    }

    private func findNodeExecutable() -> URL? {
        if let bundledNode = Bundle.main.resourceURL?.appendingPathComponent("node/bin/node"),
           FileManager.default.isExecutableFile(atPath: bundledNode.path) {
            return bundledNode
        }

        for candidate in [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ] {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return URL(fileURLWithPath: candidate)
            }
        }

        return nil
    }

    private func handleServerOutput(_ data: Data) {
        guard !data.isEmpty else { return }
        serverOutput.append(data)
        guard let text = String(data: serverOutput, encoding: .utf8) else { return }
        serverStartError = text
        guard let url = firstServerURL(in: text), !didLoadServer else { return }
        didLoadServer = true
        DispatchQueue.main.async { [weak self] in
            self?.webView.load(URLRequest(url: url))
        }
    }

    private func firstServerURL(in text: String) -> URL? {
        for token in text.split(whereSeparator: { $0.isWhitespace }) {
            if token.hasPrefix("http://127.0.0.1:"), let url = URL(string: String(token)) {
                return url
            }
        }
        return nil
    }

    private func showError(_ message: String) {
        let escapedMessage = escapeHtml(message).replacingOccurrences(of: "\n", with: "<br>")
        let html = """
        <!doctype html>
        <html>
        <body style="font:16px -apple-system; padding:32px; background:#111318; color:#eef3fa; line-height:1.5">
          <h1>Electric Lamb</h1>
          <p>\(escapedMessage)</p>
        </body>
        </html>
        """
        webView?.loadHTMLString(html, baseURL: nil)
    }

    private func showMissingNodeError() {
        showError("""
        Node.js is required for the lightweight Electric Lamb build.

        Install Node.js, then reopen Electric Lamb:
        - Homebrew: brew install node
        - Official installer: https://nodejs.org/

        This thin build stays small by using your local Node runtime. Use the standalone package target when you need a bundled runtime.
        """)
    }

    private func escapeHtml(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
