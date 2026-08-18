/*
 * Engagement events.
 *
 * GA4's enhanced measurement gives a pageview and a single scroll event at 90%.
 * For a set of articles whose whole argument is made by interactive figures,
 * that cannot distinguish "bounced at the first chart" from "read the thing and
 * played with every widget" — and it never says whether a figure was touched at
 * all. These three events answer that and nothing more.
 *
 * Deliberately small: no library, no per-page configuration, no identifiers.
 * It reads the DOM it is dropped into and infers what it can.
 */
(function () {
  if (typeof window.gtag !== 'function') return

  var sent = {}
  function once(name, params) {
    var key = name + ':' + ((params && (params.id || params.percent)) || '')
    if (sent[key]) return
    sent[key] = 1
    window.gtag('event', name, params || {})
  }

  /* Reading depth.

     Quartiles rather than enhanced measurement's single 90% event: where people
     stop is the useful signal, and "did they reach the end" is a different
     question from "how far did they get".

     The 100% mark does NOT come from the same arithmetic. These pages grow as
     their figures build themselves, so scrollHeight is a moving target and the
     computed bottom is routinely unreachable — on sharkhunt the page reports
     about 2.6k more pixels of scroll range than it will actually travel. So the
     end is detected positionally, from a sentinel parked below all content.

     Everything here is gated on an actual scroll event. An earlier version used
     an IntersectionObserver on the sentinel, which reported a completed read to
     every single visitor of any article whose content hydrates after load: the
     sentinel sits in the first viewport until the body fills in underneath it. */
  var marks = [25, 50, 75]
  var hit = {}
  var sentinel = null

  function addSentinel() {
    if (!document.body || sentinel) return
    sentinel = document.createElement('div')
    sentinel.setAttribute('aria-hidden', 'true')
    sentinel.style.cssText = 'height:1px;width:100%;margin:0;padding:0;pointer-events:none'
    document.body.appendChild(sentinel)
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', addSentinel)
  else addSentinel()

  addEventListener(
    'scroll',
    function () {
      var doc = document.documentElement
      var max = doc.scrollHeight - window.innerHeight
      if (max > 0) {
        var pct = (window.scrollY / max) * 100
        for (var i = 0; i < marks.length; i++) {
          var m = marks[i]
          if (pct >= m && !hit[m]) {
            hit[m] = 1
            once('read_depth', { percent: m })
          }
        }
      }
      if (sentinel && !hit[100] && sentinel.getBoundingClientRect().top <= window.innerHeight) {
        hit[100] = 1
        once('read_depth', { percent: 100 })
      }
    },
    { passive: true },
  )

  /* Was a figure touched at all? One event per widget, first interaction only —
     the question is "used", not "used a lot", and a slider drag would otherwise
     bury everything else under a hundred identical events. */
  function widgetId(el) {
    var box = el.closest('figure, .fig, .figure, .widget, .wide, section[id], div[id]')
    return (box && (box.id || box.getAttribute('data-widget'))) || el.id || el.tagName.toLowerCase()
  }

  var types = ['pointerdown', 'input', 'change']
  for (var t = 0; t < types.length; t++) {
    addEventListener(
      types[t],
      function (e) {
        var el = e.target
        if (!(el instanceof Element)) return
        /* Only things a reader manipulates. Prose clicks and nav are not
           interaction with a figure and would drown the signal. */
        if (!el.closest('canvas, svg, input, select, button, [role="slider"]')) return
        once('widget_interact', { id: String(widgetId(el)).slice(0, 90) })
      },
      { passive: true, capture: true },
    )
  }

  /* The inline links to sibling articles. Not deduped: a second click is a real
     second attempt to leave, and there are at most a couple per page. */
  addEventListener(
    'click',
    function (e) {
      if (!(e.target instanceof Element)) return
      var a = e.target.closest('a.xref')
      if (a) window.gtag('event', 'crosslink_click', { link_url: a.href })
    },
    { capture: true },
  )
})()
