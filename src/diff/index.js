import { EMPTY_OBJ, EMPTY_ARR } from '../constants';
import { Component } from '../component';
import { Fragment } from '../create-element';
import { diffChildren, toChildArray } from './children';
import { diffProps } from './props';
import { assign, removeNode } from '../util';
import options from '../options';

/**
 * Diff two virtual nodes and apply proper changes to the DOM
 * @param {import('../internal').PreactElement} parentDom The parent of the DOM element
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').VNode} oldVNode The old virtual node
 * @param {object} context The current context object
 * @param {boolean} isSvg Whether or not this element is an SVG node
 * @param {Array<import('../internal').PreactElement>} excessDomChildren
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {Element | Text} oldDom The current attached DOM
 * element any new dom elements should be placed around. Likely `null` on first
 * render (except when hydrating). Can be a sibling DOM element when diffing
 * Fragments that have siblings. In most cases, it starts out as `oldChildren[0]._dom`.
 * @param {boolean} [isHydrating] Whether or not we are in hydration
 */
export function diff(
	parentDom,
	newVNode,
	oldVNode,
	context,
	isSvg,
	excessDomChildren,
	commitQueue,
	oldDom,
	isHydrating
) {
	let tmp,
		newType = newVNode.type;

	// When passing through createElement it assigns the object
	// constructor as undefined. This to prevent JSON-injection.
	if (newVNode.constructor !== undefined) return null;

	if ((tmp = options._diff)) tmp(newVNode);

	try {
		outer: if (typeof newType === 'function') {
			let c, isNew, oldProps, oldState, snapshot, clearProcessingException;
			let newProps = newVNode.props;

			// Necessary for createContext api. Setting this property will pass
			// the context value as `this.context` just for this component.
			tmp = newType.contextType;
			let provider = tmp && context[tmp._id];
			let cctx = tmp
				? provider
					? provider.props.value
					: tmp._defaultValue
				: context;

			// Get component and set it to `c`
			if (oldVNode._component) {
				c = newVNode._component = oldVNode._component;
				clearProcessingException = c.__data._processingException =
					c.__data._pendingError;
			} else {
				// Instantiate the new component
				if ('prototype' in newType && newType.prototype.render) {
					newVNode._component = c = new newType(newProps, cctx); // eslint-disable-line new-cap
				} else {
					newVNode._component = c = new Component(newProps, cctx);
					c.constructor = newType;
					c.render = doRender;
				}
				if (provider) provider.sub(c);

				c.props = newProps;
				if (!c.state) c.state = {};
				if (!c.__data) c.__data = {};
				c.context = cctx;
				c.__data._context = context;
				isNew = c.__data._dirty = true;
				c.__data._renderCallbacks = [];
			}

			const { __data: compData } = c;

			// Invoke getDerivedStateFromProps
			if (compData._nextState == null) {
				compData._nextState = c.state;
			}
			if (newType.getDerivedStateFromProps != null) {
				if (compData._nextState == c.state) {
					compData._nextState = assign({}, compData._nextState);
				}

				assign(
					compData._nextState,
					newType.getDerivedStateFromProps(newProps, compData._nextState)
				);
			}

			oldProps = c.props;
			oldState = c.state;

			// Invoke pre-render lifecycle methods
			if (isNew) {
				if (
					newType.getDerivedStateFromProps == null &&
					c.componentWillMount != null
				) {
					c.componentWillMount();
				}

				if (c.componentDidMount != null) {
					compData._renderCallbacks.push(c.componentDidMount);
				}
			} else {
				if (
					newType.getDerivedStateFromProps == null &&
					compData._force == null &&
					c.componentWillReceiveProps != null
				) {
					c.componentWillReceiveProps(newProps, cctx);
				}

				if (
					!compData._force &&
					c.shouldComponentUpdate != null &&
					c.shouldComponentUpdate(newProps, compData._nextState, cctx) === false
				) {
					c.props = newProps;
					c.state = compData._nextState;
					compData._dirty = false;
					c._vnode = newVNode;
					newVNode._dom = oldVNode._dom;
					newVNode._children = oldVNode._children;
					if (compData._renderCallbacks.length) {
						commitQueue.push(c);
					}
					for (tmp = 0; tmp < newVNode._children.length; tmp++) {
						if (newVNode._children[tmp]) {
							newVNode._children[tmp]._parent = newVNode;
						}
					}
					break outer;
				}

				if (c.componentWillUpdate != null) {
					c.componentWillUpdate(newProps, compData._nextState, cctx);
				}

				if (c.componentDidUpdate != null) {
					compData._renderCallbacks.push(() => {
						c.componentDidUpdate(oldProps, oldState, snapshot);
					});
				}
			}

			c.context = cctx;
			c.props = newProps;
			c.state = compData._nextState;

			if ((tmp = options._render)) tmp(newVNode);

			compData._dirty = false;
			c._vnode = newVNode;
			compData._parentDom = parentDom;

			tmp = c.render(c.props, c.state, c.context);
			let isTopLevelFragment =
				tmp != null && tmp.type == Fragment && tmp.key == null;
			newVNode._children = toChildArray(
				isTopLevelFragment ? tmp.props.children : tmp
			);

			if (c.getChildContext != null) {
				context = assign(assign({}, context), c.getChildContext());
			}

			if (!isNew && c.getSnapshotBeforeUpdate != null) {
				snapshot = c.getSnapshotBeforeUpdate(oldProps, oldState);
			}

			diffChildren(
				parentDom,
				newVNode,
				oldVNode,
				context,
				isSvg,
				excessDomChildren,
				commitQueue,
				oldDom,
				isHydrating
			);

			c.base = newVNode._dom;

			if (compData._renderCallbacks.length) {
				commitQueue.push(c);
			}

			if (clearProcessingException) {
				compData._pendingError = compData._processingException = null;
			}

			compData._force = null;
		} else {
			newVNode._dom = diffElementNodes(
				oldVNode._dom,
				newVNode,
				oldVNode,
				context,
				isSvg,
				excessDomChildren,
				commitQueue,
				isHydrating
			);
		}

		if ((tmp = options.diffed)) tmp(newVNode);
	} catch (e) {
		options._catchError(e, newVNode, oldVNode);
	}

	return newVNode._dom;
}

/**
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {import('../internal').VNode} root
 */
export function commitRoot(commitQueue, root) {
	if (options._commit) options._commit(root, commitQueue);

	commitQueue.some(c => {
		try {
			const { __data } = c;
			commitQueue = __data._renderCallbacks;
			__data._renderCallbacks = [];
			commitQueue.some(cb => {
				cb.call(c);
			});
		} catch (e) {
			options._catchError(e, c._vnode);
		}
	});
}

/**
 * Diff two virtual nodes representing DOM element
 * @param {import('../internal').PreactElement} dom The DOM element representing
 * the virtual nodes being diffed
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').VNode} oldVNode The old virtual node
 * @param {object} context The current context object
 * @param {boolean} isSvg Whether or not this DOM node is an SVG node
 * @param {*} excessDomChildren
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {boolean} isHydrating Whether or not we are in hydration
 * @returns {import('../internal').PreactElement}
 */
function diffElementNodes(
	dom,
	newVNode,
	oldVNode,
	context,
	isSvg,
	excessDomChildren,
	commitQueue,
	isHydrating
) {
	let i;
	let oldProps = oldVNode.props;
	let newProps = newVNode.props;

	// Tracks entering and exiting SVG namespace when descending through the tree.
	isSvg = newVNode.type === 'svg' || isSvg;

	if (dom == null && excessDomChildren != null) {
		for (i = 0; i < excessDomChildren.length; i++) {
			const child = excessDomChildren[i];

			if (
				child != null &&
				(newVNode.type === null
					? child.nodeType === 3
					: child.localName === newVNode.type)
			) {
				dom = child;
				excessDomChildren[i] = null;
				break;
			}
		}
	}

	if (dom == null) {
		if (newVNode.type === null) {
			return document.createTextNode(newProps);
		}
		dom = isSvg
			? document.createElementNS('http://www.w3.org/2000/svg', newVNode.type)
			: document.createElement(newVNode.type);
		// we created a new parent, so none of the previously attached children can be reused:
		excessDomChildren = null;
	}

	if (newVNode.type === null) {
		if (excessDomChildren != null) {
			excessDomChildren[excessDomChildren.indexOf(dom)] = null;
		}

		if (oldProps !== newProps) {
			dom.data = newProps;
		}
	} else if (newVNode !== oldVNode) {
		if (excessDomChildren != null) {
			excessDomChildren = EMPTY_ARR.slice.call(dom.childNodes);
		}

		oldProps = oldVNode.props || EMPTY_OBJ;

		let oldHtml = oldProps.dangerouslySetInnerHTML;
		let newHtml = newProps.dangerouslySetInnerHTML;

		// During hydration, props are not diffed at all (including dangerouslySetInnerHTML)
		// @TODO we should warn in debug mode when props don't match here.
		if (!isHydrating) {
			if (oldProps === EMPTY_OBJ) {
				oldProps = {};
				for (let i = 0; i < dom.attributes.length; i++) {
					oldProps[dom.attributes[i].name] = dom.attributes[i].value;
				}
			}

			if (newHtml || oldHtml) {
				// Avoid re-applying the same '__html' if it did not changed between re-render
				if (!newHtml || !oldHtml || newHtml.__html != oldHtml.__html) {
					dom.innerHTML = (newHtml && newHtml.__html) || '';
				}
			}
		}

		diffProps(dom, newProps, oldProps, isSvg, isHydrating);

		newVNode._children = newVNode.props.children;

		// If the new vnode didn't have dangerouslySetInnerHTML, diff its children
		if (!newHtml) {
			diffChildren(
				dom,
				newVNode,
				oldVNode,
				context,
				newVNode.type === 'foreignObject' ? false : isSvg,
				excessDomChildren,
				commitQueue,
				EMPTY_OBJ,
				isHydrating
			);
		}

		// (as above, don't diff props during hydration)
		if (!isHydrating) {
			if (
				'value' in newProps &&
				newProps.value !== undefined &&
				newProps.value !== dom.value
			) {
				dom.value = newProps.value == null ? '' : newProps.value;
			}
			if (
				'checked' in newProps &&
				newProps.checked !== undefined &&
				newProps.checked !== dom.checked
			) {
				dom.checked = newProps.checked;
			}
		}
	}

	return dom;
}

/**
 * Invoke or update a ref, depending on whether it is a function or object ref.
 * @param {object|function} ref
 * @param {any} value
 * @param {import('../internal').VNode} vnode
 */
export function applyRef(ref, value, vnode) {
	try {
		if (typeof ref == 'function') ref(value);
		else ref.current = value;
	} catch (e) {
		options._catchError(e, vnode);
	}
}

/**
 * Unmount a virtual node from the tree and apply DOM changes
 * @param {import('../internal').VNode} vnode The virtual node to unmount
 * @param {import('../internal').VNode} parentVNode The parent of the VNode that
 * initiated the unmount
 * @param {boolean} [skipRemove] Flag that indicates that a parent node of the
 * current element is already detached from the DOM.
 */
export function unmount(vnode, parentVNode, skipRemove) {
	let r;
	if (options.unmount) options.unmount(vnode);

	if ((r = vnode.ref)) {
		applyRef(r, null, parentVNode);
	}

	let dom;
	if (!skipRemove && typeof vnode.type !== 'function') {
		skipRemove = (dom = vnode._dom) != null;
	}

	vnode._dom = vnode._lastDomChild = null;

	if ((r = vnode._component) != null) {
		if (r.componentWillUnmount) {
			try {
				r.componentWillUnmount();
			} catch (e) {
				options._catchError(e, parentVNode);
			}
		}

		r.base = r.__data._parentDom = null;
	}

	if ((r = vnode._children)) {
		for (let i = 0; i < r.length; i++) {
			if (r[i]) unmount(r[i], parentVNode, skipRemove);
		}
	}

	if (dom != null) removeNode(dom);
}

/** The `.render()` method for a PFC backing instance. */
function doRender(props, state, context) {
	return this.constructor(props, context);
}
