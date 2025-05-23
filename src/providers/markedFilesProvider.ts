import {
	Event,
	EventEmitter,
	TreeDataProvider,
	TreeItem,
	Uri,
	workspace,
	RelativePattern,
	FileSystemWatcher,
	FileDecorationProvider,
	FileDecoration,
	window,
} from 'vscode';
import { getBasename, getDirname } from '../utils/fileUtils';
import {
	getConfig,
	showMessage,
	validateWorkspace,
} from '../utils/vscodeUtils';
import { estimateTokenCount } from '../utils/tokenUtils';
import { createContextGenerator } from '../generators/contextGenerator';

export const markedFiles = new Set<string>();
export const forceIncludedFiles = new Set<string>();

export class MarkedFilesProvider
	implements TreeDataProvider<TreeItem>, FileDecorationProvider
{
	private _tokenCount = 0;

	private _onDidChangeTreeData: EventEmitter<
		TreeItem | undefined | null | void
	> = new EventEmitter<TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | undefined | null | void> =
		this._onDidChangeTreeData.event;
	private fileWatcher: FileSystemWatcher | undefined;
	private _onDidChangeFileDecorations: EventEmitter<Uri | Uri[] | undefined> =
		new EventEmitter<Uri | Uri[] | undefined>();
	readonly onDidChangeFileDecorations: Event<Uri | Uri[] | undefined> =
		this._onDidChangeFileDecorations.event;

	constructor() {
		this.initializeFileWatcher();
		window.registerFileDecorationProvider(this);
	}

	private initializeFileWatcher(): void {
		if (!workspace.workspaceFolders) {
			return;
		}

		// Watch all files in the workspace
		const pattern = new RelativePattern(workspace.workspaceFolders[0], '**/*');
		this.fileWatcher = workspace.createFileSystemWatcher(pattern);

		// Handle file deletion
		this.fileWatcher.onDidDelete((uri) => {
			if (markedFiles.has(uri.fsPath)) {
				markedFiles.delete(uri.fsPath);
				this.refresh();
				showMessage.info(
					`Removed deleted file from marked files: ${getBasename(uri.fsPath)}`,
				);
			}
		});

		// Handle file content changes
		this.fileWatcher.onDidChange((uri) => {
			if (markedFiles.has(uri.fsPath)) {
				this.handleFileChange();
			}
		});

		// Handle file renaming/moving using workspace.onDidRenameFiles
		workspace.onDidRenameFiles(({ files }) => {
			files.forEach(({ oldUri, newUri }) => {
				if (markedFiles.has(oldUri.fsPath)) {
					markedFiles.delete(oldUri.fsPath);
					markedFiles.add(newUri.fsPath);
					this.refresh();
					showMessage.info(
						`Updated marked file path: ${getBasename(oldUri.fsPath)} → ${getBasename(newUri.fsPath)}`,
					);
				}
			});
		});
	}

	private notifyDecorationChange() {
		this._onDidChangeFileDecorations.fire(undefined);
	}

	async refresh(): Promise<void> {
		await this.updateTokenCount();
		this._onDidChangeTreeData.fire();
		this.notifyDecorationChange();
	}

	provideFileDecoration(uri: Uri): FileDecoration | undefined {
		if (uri.scheme === 'marked-view') {
			return undefined;
		}

		if (markedFiles.has(uri.fsPath)) {
			return {
				badge: '📎',
				tooltip: 'Marked for LLM Context',
			};
		}
		return undefined;
	}

	dispose(): void {
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
		}
	}

	getTreeItem(element: TreeItem): TreeItem {
		return element;
	}

	getChildren(element?: TreeItem): Thenable<TreeItem[]> {
		if (element) {
			return Promise.resolve([]);
		}

		// Only show file items
		const fileItems = Array.from(markedFiles).map((filePath) => {
			const treeItem = new TreeItem(getBasename(filePath));
			treeItem.description = getDirname(filePath);
			treeItem.command = {
				command: 'vscode.open',
				title: 'Open Marked File',
				arguments: [Uri.file(filePath)],
			};
			treeItem.contextValue = 'markedFile';
			// Create a URI with a different scheme to avoid decorations
			treeItem.resourceUri = Uri.parse(`marked-view://${filePath}`);
			return treeItem;
		});

		return Promise.resolve(fileItems);
	}

	getTokenCountDisplay(): string {
		return `${this._tokenCount} tokens${
			this._tokenCount > getConfig().tokenWarningThreshold ? '⚠' : ''
		}`;
	}

	private async updateTokenCount(): Promise<void> {
		if (markedFiles.size === 0) {
			this._tokenCount = 0;
			return;
		}
		const workspacePath = validateWorkspace();
		if (!workspacePath) {
			return;
		}

		// Pass forceIncludedFiles so forcibly marked files are always counted
		const contextGenerator = createContextGenerator(workspacePath, forceIncludedFiles);
		const formattedContext = await contextGenerator.generateContext({
			markedFiles: Array.from(markedFiles),
		});

		this._tokenCount = await estimateTokenCount(formattedContext);
	}

	private async handleFileChange(): Promise<void> {
		await this.updateTokenCount();
		this.refresh();
	}
}

// Export a singleton provider instance for global use
// Must be declared after the class definition to avoid 'used before its declaration' error
export const markedFilesProvider = new MarkedFilesProvider();
