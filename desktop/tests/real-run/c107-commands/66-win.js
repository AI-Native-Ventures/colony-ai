return await S.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ content: w.getContentBounds(), bounds: w.getBounds(), visible: w.isVisible() })));
