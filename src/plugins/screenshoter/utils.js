import path from "path";
import fs from "fs";
import Promise from "bluebird";
import jimp from "jimp";
import util from "util";
import mkdirp from "mkdirp";

export let utils = {
	getBrowserName( browser ) {
		return browser.getCapabilities();
	},
	fileExists( filePath ) {
		return new Promise( resolve => {
			fs.lstat( filePath, err => {
				resolve( !err );
			} );
		} );
	},
	removeFile( filePath ) {
		return new Promise( ( resolve, reject ) => {
			fs.unlink( filePath, err => {
				if ( err ) {
					reject( err );
				} else {
					resolve();
				}
			} );
		} );
	},
	removeFiles( ...files ) {
		return Promise.all( files.map( file => {
			return this.removeFile( file );
		} ) );
	},
	writeImage( img, filePath ) {
		return new Promise( ( resolve, reject ) => {
			img.write( filePath, err => {
				if ( err ) {
					reject( err );
				} else {
					resolve();
				}
			} );
		} );
	},
	compare( baseline, regressionImg, tolerance ) {
		return jimp.read( baseline ).then( baselineImg => {
			const distance = jimp.distance( baselineImg, regressionImg );
			const diff = jimp.diff( baselineImg, regressionImg );
			return {
				diffImg: diff.image,
				isEqual: distance <= Math.max( 0.02, tolerance ) && diff.percent <= tolerance,
				equality: `distance: ${distance}, percent: ${diff.percent}`
			};
		} );
	},
	getBoundingClientRect( selector, cb ) {
		let elem = document.querySelector( selector );
		if ( !( elem instanceof Element ) ) {
			throw new Error( "Invalid selector: " + selector );
		}

		let rect = elem.getBoundingClientRect();
		let ratio = window.devicePixelRatio;
		cb( {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			ratio: ratio
		} );
	},
	takeImageOf( browser, { selector = "body", offsetX = 0, offsetY = 0, offsetWidth = 0, offsetHeight = 0 } = {} ) {
		return browser.executeAsyncScript( this.getBoundingClientRect, selector ).then( ( rect ) => {
			rect.left += offsetX;
			rect.top += offsetY;
			rect.width += offsetWidth;
			rect.height += offsetHeight;
			return browser.takeScreenshot().then( base64 => {
				return jimp.read( new Buffer( base64, "base64" ) ).then( img => {
					if ( rect.ratio > 1 ){
						img.scale( 1 / rect.ratio );
					}
					img.crop( rect.left, rect.top, rect.width, rect.height );
					return {
						rect: rect,
						img: img
					};
				} );
			} );
		} ).then( meta => {
			return this.getBrowserName( browser ).then( caps => {
				return {
					img: meta.img,
					rect: meta.rect,
					browserName: caps.get( "browserName" ).replace( " ", "-" ),
					artifactsPath: browser.artifactsPath,
					platform: caps.get( "platform" ).replace( / /g, "-" ).toLowerCase()
				};
			} );
		} );
	},
	matchImageOf( id, folder = "", tolerance = 0.002 ) {
		return this._obj.then( meta => { //eslint-disable-line no-underscore-dangle
			let imageName = util.format( "%s-%s-%s.png", id, meta.platform, meta.browserName );

			mkdirp.sync( path.resolve( meta.artifactsPath, "baseline", folder ) );
			mkdirp.sync( path.resolve( meta.artifactsPath, "regression", folder ) );
			mkdirp.sync( path.resolve( meta.artifactsPath, "diff", folder ) );

			let baseline = path.resolve( meta.artifactsPath, "baseline", folder, imageName );
			let regression = path.resolve( meta.artifactsPath, "regression", folder, imageName );
			let diff = path.resolve( meta.artifactsPath, "diff", folder, imageName );

			//Injecting images into assert
			let expected = {
				baseline: path.join( "baseline", folder, imageName ).replace( /\\/g, "/" ),
				diff: path.join( "diff", folder, imageName ).replace( /\\/g, "/" ),
				regression: path.join( "regression", folder, imageName ).replace( /\\/g, "/" )
			};

			let actual = {};

			return utils.fileExists( baseline ).then( exists => {
				if ( !exists ) {
					return utils.writeImage( meta.img, baseline ).then( () => {
						this.assert(
							false,
							`No baseline found! New baseline generated at ${meta.artifactsPath + "/" + expected.baseline}`,
							`No baseline found! New baseline generated at ${meta.artifactsPath + "/" + expected.baseline}`,
							expected,
							actual
						);
					} );
				} else {
					return utils.compare( baseline, meta.img, tolerance ).then( comparison => {
						if ( comparison.isEqual ) {
							return comparison;
						} else {
							return Promise.all( [utils.writeImage( meta.img, regression ), utils.writeImage( comparison.diffImg, diff )] ).then( () => {
								this.assert(
									comparison.isEqual === true,
									`expected ${id} equality to be less than ${tolerance}, but was ${comparison.equality}`,
									`expected ${id} equality to be greater than ${tolerance}, but was ${comparison.equality}`,
									expected,
									actual );
								return comparison;
							} );
						}
					} );
				}
			} );
		} );
	}
};

export default utils;
