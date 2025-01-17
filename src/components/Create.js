import React, { useEffect, useState } from 'react';
import { sha256 } from 'js-sha256';
import { get, set, del } from '../utils/storage';
import { getPackageRange } from '../state/views';
import { GAS, contractId, marketId, parseNearAmount } from '../state/near';
import { setDialog } from '../state/app';
import { getParams, IFRAME_ALLOW } from '../state/code';

import { Menu } from './Menu';
import { Editor, examples } from './Editor';

const PENDING_SERIES_UPDATE = '__PENDING_SERIES_UPDATE__';

export const Create = ({ app, views, update, dispatch, account }) => {

	const { createMenu, consoleLog } = app;
	const { packages } = views;

	const [console, setConsole] = useState(false);
	const [preview, setPreview] = useState(true);
	const [example, setExample] = useState(-1);
	const [sideBy, setSideBy] = useState(true);
	const [showPackages, setShowPackages] = useState(false);
	const [showExamples, setShowExamples] = useState(false);
	const [packageFilter, setPackageFilter] = useState('');

	const init = async () => {
		await dispatch(getPackageRange());
		checkSeriesUpdate();
	};
	useEffect(init, []);

	const checkSeriesUpdate = async () => {
		if (!account) return
		const { series_name, src, attempts } = get(PENDING_SERIES_UPDATE + account.accountId);
		if (series_name) {
			const data = await account.viewFunction(contractId, 'series_data', { series_name }, GAS);
			if (data.src === src) {
				return del(PENDING_SERIES_UPDATE + account.accountId);
			}
			const result = await account.functionCall(contractId, 'series_update', { series_name, src }, GAS);
			console.log('series updated', result);
		}
	};

	const includePackage = (i) => {
		const { params } = getParams(code);
		const pkg = packages[i].name_version;
		if (!params.packages.includes(pkg)) params.packages.push(pkg);
		setCode(code.replace(new RegExp(`packages: .*,`, 'g'), `packages: ${JSON.stringify(params.packages)},`));
	};

	const addPackage = async () => {
		const result = await dispatch(setDialog({
			msg: 'Adding a JavaScript Library',
			input: [
				{placeholder: 'name@version (exactly like this)'},
				{placeholder: 'CDN URL?'},
			]
		}));
		if (!result) return;
		const [name_version, url] = result;
		if (!name_version.length || !url.length) {
			return dispatch(setDialog({
				msg: 'Enter a name@version and CDN URL',
				info: true
			}));
		}
		const urls = [url];
		const src_hash = sha256(await fetch(urls[0]).then(r => r.text()));

		await account.functionCall(contractId, 'add_package', {
			name_version,
			urls,
			src_hash
		}, GAS, parseNearAmount('1'));
	};

	const handleCreateSeries = async () => {
		let { params } = getParams(code);

		const sellNow = true; //window.confirm('Sell series now?');
		const result = await dispatch(setDialog({
			msg: 'Creating New Series',
			input: [
				{placeholder: 'Series Name?'},
				{placeholder: 'Unit Price in NEAR?', type: 'number'},
			]
		}));
		if (!result) return;
		let [series_name, price] = result;
		series_name = series_name.trim().toLowerCase();
		if (!series_name.length || series_name.length > 255 || /[\s|^%#*@`+=?:;'"\{\}\[\]<>\/\\]/g.test(series_name)) {
			return dispatch(setDialog({
				msg: 'Invalid Series Name. No special characters like: |^%#*@`+=?:;\'". Only "-" and "_".',
				info: true
			}));
		}
		if (!/^\d+$/.test(price) || parseInt(price) === NaN) {
			return dispatch(setDialog({
				msg: 'Enter a Series Name and Price in NEAR',
				info: true
			}));
		}
		
		// console.log(series_name, price)

		set(PENDING_SERIES_UPDATE + account.accountId, { series_name, src: code, attempts: 0 });

		params =  {
			max_supply: params.max_supply,
			enforce_unique_mint_args: params.enforce_unique_mint_args || false,
			enforce_unique_owner_args: params.enforce_unique_owner_args || false,
			mint: Object.keys(params.mint),
			owner: Object.keys(params.owner),
			packages: params.packages,
		};

		if (sellNow) {
			account.functionCall(contractId, 'series_create_and_approve', {
				series_name,
				bytes: code.length.toString(),
				params,
				account_id: marketId,
				msg: JSON.stringify({
					sale_conditions: [
						{ ft_token_id: "near", price: parseNearAmount(price) }
					]
				})
			}, GAS, parseNearAmount('1'));
		} else {
			account.functionCall(contractId, 'series_create', {
				series_name,
				bytes: code.length.toString(),
				params,
			}, GAS, parseNearAmount('1'));
		}
	};

	const packageMenu = {
		'- Add New Package': addPackage,
		'- Filter': { frag: <input type="text" onChange={(e) => setPackageFilter(e.target.value)} /> },
	};
	packages.filter(({ name_version }) => name_version.indexOf(packageFilter) > -1)
		.forEach(({ name_version }, i) => packageMenu['- ' + name_version] = () => includePackage(i));

	const examplesMenu = {};
	examples.forEach(({ series_name }, i) => 
		examplesMenu['- ' + series_name] = () => setExample(i)
	);

	const options = {
		[preview ? '▷ Hide Preview' : '▷ Show Preview']: () => {
			setPreview(!preview);
			// updateEditorAndPreview(editor);
		},
		[sideBy ? '▷ Bottom Preview' : '▷ Side Preview']: () => { setSideBy(!sideBy); },
		[showPackages ? '▽ Hide Packages' : '▷ Show Packages']: {
			fn: () => { setShowPackages(!showPackages); },
			close: false
		},
		...(showPackages ? packageMenu : {}),
		[showExamples ? '▽ Hide Examples' : '▷ Show Examples']: {
			fn: () => { setShowExamples(!showExamples); },
			close: false
		},
		...(showExamples ? examplesMenu : {}),
		// '▷ Max Supply': () => setCode(code.replace(/max_supply:.*,/g, `max_supply: '${window.prompt('What should the max supply be?')}',`)),
		// '▷ Add Mint Parameter': () => {
		// 	const index = code.indexOf('mint: {') + 'mint: {'.length;
		// 	setCode([
		// 		code.slice(0, index),
		// 		`\n\t\t${window.prompt('name')}: {\n\t\t\tdefault: ${window.prompt('default value')},\n\t\t\ttype: ${window.prompt('type')},\n\t\t},`,
		// 		code.slice(index)
		// 	].join(''));
		// },
		// '▷ Add Owner Parameter': () => setCode(code.replace(new RegExp(`max_supply: .*,`, 'g'), `max_supply: '${window.prompt('what?')}',`)),
	};

	return <>

		<div className="menu no-barcode">
			<div className="bar">
				<div>
					<span onClick={() => update('app.createMenu', createMenu === 'left' ? false : 'left')}>Options</span>
					&nbsp;
					<span onClick={() => {
						setShowExamples(!createMenu);
						update('app.createMenu', createMenu === 'left' ? false : 'left');
					}}>Examples</span>
				</div>
				<div onClick={() => handleCreateSeries()}><span>Create</span></div>
			</div>
			{
				createMenu === 'left' && <div className="sub below">
					<Menu {...{
						app, menuKey: 'createMenu', update, options,
					}} />
				</div>
			}
		</div>

		<div className={["create", sideBy ? "side-by" : ""].join(' ')}>
			<div className="editor-wrap">
				<Editor {...{preview, example, dispatch}} />
			</div>
			<div className={preview ? 'iframe' : 'iframe display-none'}>
				<iframe {...{
					id: 'create-preview',
					allow: IFRAME_ALLOW,
				}} />
			</div>
		</div>

		<div className={['console', console ? 'active' : ''].join(' ')}>
			<div onClick={() => setConsole(!console)}>{console ? '▽ Hide Console' : '▷ Show Console'}</div>
			<div className="output">
				{
					consoleLog.map((entry, i) => <div key={i}><span>{i}: </span>{entry}</div>)
				}
			</div>
		</div>

	</>;
};

