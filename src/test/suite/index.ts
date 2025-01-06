import * as path from 'path';
import * as Mocha from 'mocha';
import * as fs from 'fs';

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise<void>((c, e) => {
		fs.readdir(testsRoot, (err, files) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files
				.filter((f) => f.endsWith('.test.js'))
				.forEach((f) => {
					mocha.addFile(path.resolve(testsRoot, f));
				});

			try {
				// Run the mocha test
				mocha.run((failures) => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				console.error(err);
				e(err);
			}
		});
	});
}
