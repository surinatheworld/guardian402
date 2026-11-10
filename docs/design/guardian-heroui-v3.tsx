import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Card} from '@heroui/react/card';
import {Button} from '@heroui/react/button';
import {Chip} from '@heroui/react/chip';
import {Tabs} from '@heroui/react/tabs';
import {Switch} from '@heroui/react/switch';
import {Label} from '@heroui/react/label';
import {ProgressBar} from '@heroui/react/progress-bar';
import {Modal} from '@heroui/react/modal';
import {Table} from '@heroui/react/table';
import {Input} from '@heroui/react/input';

type Entry = {id:string; name:string; target:string; amount:string; time:string; blocked:boolean; reason:string; summary:string; before:string; after:string; token:string};
const entries:Entry[] = [
  {id:'lookalike',name:'Cấp quyền USDC',target:'Địa chỉ nhái router',amount:'Không giới hạn',time:'14:32',blocked:true,reason:'Địa chỉ nhái',summary:'Địa chỉ nhận quyền chi tiêu trông giống router đã biết, nhưng là một địa chỉ khác. Guardian đánh giá rủi ro cao.',before:'100.00',after:'100.00',token:'0.00'},
  {id:'swap',name:'Swap USDC → mWAVAX',target:'MockRouter · DEMO',amount:'−2.00 USDC',time:'14:30',blocked:false,reason:'Không phát hiện vi phạm',summary:'Đổi 2 USDC qua router được cho phép. Guardian đánh giá rủi ro thấp; vault kiểm tra chính sách trước khi thực thi.',before:'102.00',after:'100.00',token:'+0.08'},
  {id:'slippage',name:'Swap USDC → mWAVAX',target:'Trượt giá cao',amount:'2.00 đề xuất',time:'14:28',blocked:true,reason:'Trượt giá vượt ngưỡng',summary:'Pool mô phỏng trả về ít token hơn mức tham chiếu 30%. Đề xuất bị chặn trước khi thực thi.',before:'102.00',after:'102.00',token:'0.00'},
  {id:'treasury',name:'Chuyển USDC',target:'Treasury được cho phép',amount:'−0.40 USDC',time:'14:24',blocked:false,reason:'Trong chính sách vault',summary:'Chuyển 0.40 USDC đến treasury trong danh sách cho phép. Khoản chi nằm trong hạn mức ngày.',before:'102.40',after:'102.00',token:'0.00'},
  {id:'approval',name:'Cấp quyền USDC',target:'MockRouter · 2 USDC',amount:'2.00 quyền chi',time:'14:22',blocked:false,reason:'Cấp quyền đúng giá trị',summary:'Cấp chính xác 2 USDC quyền chi tiêu cho MockRouter. Không có token rời vault trong bước cấp quyền.',before:'102.40',after:'102.40',token:'0.00'},
  {id:'drain',name:'Chuyển toàn bộ USDC',target:'Vượt hạn mức ngày',amount:'100.00 đề xuất',time:'14:20',blocked:true,reason:'Vượt hạn mức ngày',summary:'Đề xuất chuyển 100 USDC vượt hạn mức 10 USDC/ngày của dữ liệu mẫu gốc. Việc chỉnh hạn mức trong concept không thay đổi lịch sử.',before:'102.40',after:'102.40',token:'0.00'},
  {id:'revoke',name:'Thu hồi quyền USDC',target:'Allowance về 0',amount:'—',time:'14:15',blocked:false,reason:'Thu hồi quyền chi tiêu',summary:'Đưa quyền chi tiêu của spender cũ về 0. Toàn bộ token vẫn nằm trong vault.',before:'102.40',after:'102.40',token:'0.00'},
];
const titles:Record<string,[string,string]> = {
  overview:['Tổng quan','Tài sản, giới hạn và hoạt động của agent.'],
  transactions:['Giao dịch','Mỗi đề xuất đều có một quyết định và bằng chứng.'],
  vault:['AgentVault','Tài sản nằm trong vault do chủ ví kiểm soát.'],
  policy:['Chính sách','Quyết định agent được phép làm gì.'],
};
const nav = [['overview','Tổng quan'],['transactions','Giao dịch'],['vault','AgentVault'],['policy','Chính sách']];

function Status({blocked}:{blocked:boolean}) {
  return <Chip color={blocked?'danger':'success'} variant="soft" size="md" className="h3-status"><span className="h3-dot"/><Chip.Label>{blocked?'Đã chặn':'Đã thực thi'}</Chip.Label></Chip>;
}

function History({compact=false,open}:{compact?:boolean;open:(entry:Entry)=>void}) {
  const [filter,setFilter] = useState('all');
  const filtered = entries.filter(e=>filter==='all'||(filter==='blocked'?e.blocked:!e.blocked));
  const visible = compact?filtered.slice(0,4):filtered;
  return <>
    <Tabs selectedKey={filter} onSelectionChange={key=>setFilter(String(key))} className="h3-history-tabs">
      <Tabs.ListContainer><Tabs.List aria-label="Lọc giao dịch mẫu">
        <Tabs.Tab id="all">Tất cả <span className="h3-tab-count">7</span><Tabs.Indicator/></Tabs.Tab>
        <Tabs.Tab id="blocked">Đã chặn <span className="h3-tab-count">3</span><Tabs.Indicator/></Tabs.Tab>
        <Tabs.Tab id="executed">Đã thực thi <span className="h3-tab-count">4</span><Tabs.Indicator/></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
    </Tabs>
    <Table variant="secondary" className="h3-table">
      <Table.ScrollContainer><Table.Content aria-label="Giao dịch minh hoạ" onRowAction={key=>{const entry=entries.find(e=>e.id===key);if(entry)open(entry);}}>
        <Table.Header><Table.Column id="name" isRowHeader>Giao dịch</Table.Column><Table.Column id="result">Kết quả</Table.Column><Table.Column id="amount">Giá trị</Table.Column><Table.Column id="time" className="h3-time-column">Giờ</Table.Column></Table.Header>
        <Table.Body items={visible}>{entry=><Table.Row id={entry.id} textValue={entry.name}>
          <Table.Cell><div className="h3-tx-name">{entry.name}</div><div className="h3-tx-target">{entry.target}</div></Table.Cell>
          <Table.Cell><Status blocked={entry.blocked}/></Table.Cell>
          <Table.Cell><span className="h3-amount">{entry.amount}</span></Table.Cell>
          <Table.Cell className="h3-time-column"><span className="h3-time">{entry.time}</span></Table.Cell>
        </Table.Row>}</Table.Body>
      </Table.Content></Table.ScrollContainer>
    </Table>
    <div className="h3-history-foot"><span>{visible.length} giao dịch mẫu · 10 thg 11, 2026</span><span>UTC+7</span></div>
  </>;
}

export function App({portal}:{portal?:HTMLElement}) {
  const [page,setPage] = useState('overview');
  const [active,setActive] = useState(true);
  const [cap,setCap] = useState(10);
  const [input,setInput] = useState('10.00');
  const [message,setMessage] = useState('Thay đổi chỉ áp dụng trong concept.');
  const [review,setReview] = useState<Entry|null>(null);
  const [checking,setChecking] = useState(false);
  const [pendingActive,setPendingActive] = useState<boolean|null>(null);

  useEffect(()=>{
    const saved=(window as any).openai?.widgetState?.modelContent;
    if(!saved||saved.concept!=='heroui-v3')return;
    if(titles[saved.page])setPage(saved.page);
    if(typeof saved.active==='boolean')setActive(saved.active);
    if(Number.isFinite(saved.cap)&&saved.cap>=2.4&&saved.cap<=1000000){setCap(saved.cap);setInput(saved.cap.toFixed(2));}
  },[]);
  function persist(next:{page?:string;active?:boolean;cap?:number}) {
    const api=(window as any).openai;
    if(api?.setWidgetState)api.setWidgetState({modelContent:{concept:'heroui-v3',page,active,cap,...next},privateContent:null}).catch(()=>{});
  }
  function navigate(value:string){setPage(value);persist({page:value});}
  const capValue = input.trim()?Number(input):NaN;
  const valid = Number.isFinite(capValue)&&capValue>=2.4&&capValue<=1000000&&Math.abs(capValue*100-Math.round(capValue*100))<.00001;

  return <div className="h3-shell">
    <aside className="h3-sidebar">
      <div className="h3-brand">guardian<span>402</span></div>
      <div className="h3-workspace"><span className="h3-workspace-name">Guardian Workspace</span><Chip size="sm" variant="secondary">DEMO</Chip></div>
      <nav className="h3-nav" aria-label="Điều hướng">{nav.map(([key,label])=><Button key={key} variant={page===key?'primary':'ghost'} size="lg" className="h3-nav-button" aria-current={page===key?'page':undefined} onPress={()=>navigate(key)}>{label}{key==='transactions'&&<span className="h3-nav-count">7</span>}</Button>)}</nav>
      <div className="h3-sidebar-bottom"><div className="h3-network"><span className="h3-dot"/>Avalanche Fuji</div><p>Testnet · Chain 43113</p><div className="h3-owner"><span className="h3-owner-label">Ví chủ</span><span className="h3-mono">0x3f6a…7651</span></div></div>
    </aside>
    <div className="h3-main">
      <header className="h3-topbar"><span>Workspace <span className="h3-breadcrumb-slash">/</span> <strong>{titles[page][0]}</strong></span><Chip variant="soft" size="sm">HeroUI v3</Chip></header>
      <main className="h3-content">
        <div className="h3-page-head"><div><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div><Button size="lg" variant="primary" onPress={()=>setChecking(true)}><span aria-hidden="true" className="h3-plus">+</span>Kiểm tra giao dịch</Button></div>
        {page==='overview'&&<>
          <div className="h3-hero-grid">
            <Card className="h3-panel h3-balance-card">
              <Card.Header><div className="h3-card-heading"><Card.Title>Số dư trong vault</Card.Title><Chip variant="secondary" size="sm">Fuji testnet</Chip></div></Card.Header>
              <Card.Content><div className="h3-balance">100<span>.00</span><small>USDC</small></div><p className="h3-card-note">Chủ ví sở hữu tài sản. Guardian chỉ ký verdict.</p></Card.Content>
              <Card.Footer className="h3-balance-footer"><div className="h3-token-summary"><strong>0.08</strong><span>mWAVAX · mock</span></div><div className="h3-token-summary"><strong>0.25</strong><span>AVAX · testnet</span></div><Button variant="secondary" size="md" onPress={()=>navigate('vault')}>Xem vault <span aria-hidden="true">↗</span></Button></Card.Footer>
            </Card>
            <Card className="h3-panel h3-agent-card">
              <Card.Header><div className="h3-card-heading"><Card.Title>AgentVault</Card.Title><Switch size="lg" isSelected={active} onChange={setPendingActive}><Switch.Content aria-label={active?'Tạm dừng agent trong concept':'Tiếp tục agent trong concept'}><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div></Card.Header>
              <Card.Content><div className="h3-agent-title">{active?'Đang hoạt động':'Đã tạm dừng'}</div><p className="h3-card-note">{active?'Agent có thể gửi giao dịch trong giới hạn.':'Giao dịch mới của agent bị từ chối.'}</p><div className="h3-budget-label"><span>Đã chi hôm nay</span><strong>2.40 <span>/ {cap.toFixed(2)} USDC</span></strong></div><ProgressBar value={2.4} maxValue={cap} size="lg" color="default" aria-label="USDC đã chi hôm nay"><ProgressBar.Track><ProgressBar.Fill/></ProgressBar.Track></ProgressBar></Card.Content>
              <Card.Footer><Button variant="secondary" fullWidth onPress={()=>navigate('policy')}>Chỉnh giới hạn</Button></Card.Footer>
            </Card>
          </div>
          <Card className="h3-panel h3-activity-card"><Card.Header><div className="h3-card-heading"><div><Card.Title>Hoạt động gần đây</Card.Title><Card.Description>Quyết định rõ ràng. Bằng chứng cho từng giao dịch.</Card.Description></div><Button variant="ghost" size="sm" onPress={()=>navigate('transactions')}>Xem tất cả <span aria-hidden="true">→</span></Button></div></Card.Header><Card.Content><History compact open={setReview}/></Card.Content></Card>
        </>}
        {page==='transactions'&&<Card className="h3-panel h3-activity-card"><Card.Header><Card.Title>Lịch sử giao dịch</Card.Title><Card.Description>Chọn một hàng để xem verdict, mô phỏng và dữ liệu.</Card.Description></Card.Header><Card.Content><History open={setReview}/></Card.Content></Card>}
        {page==='vault'&&<Card className="h3-panel h3-vault-card"><Card.Header><div className="h3-card-heading"><Card.Title>AgentVault</Card.Title><Chip variant="secondary">Fuji testnet</Chip></div></Card.Header><Card.Content><div className="h3-balance">100<span>.00</span><small>USDC</small></div><dl className="h3-vault-facts"><div><dt>Địa chỉ vault</dt><dd className="h3-mono">0x3f6a5852788ff6a46d924C407976bB89487f7651</dd></div><div><dt>Quyền sở hữu</dt><dd>Chủ ví kiểm soát tài sản</dd></div><div><dt>Guardian</dt><dd>Chỉ ký verdict EIP-712</dd></div><div><dt>mWAVAX · mock</dt><dd>0.08</dd></div><div><dt>AVAX · testnet</dt><dd>0.25</dd></div></dl></Card.Content></Card>}
        {page==='policy'&&<Card className="h3-panel h3-policy-card"><Card.Header><Card.Title>Giới hạn của agent</Card.Title><Card.Description>Chỉnh cấu hình mẫu. Không kết nối ví hay gửi lên chain.</Card.Description></Card.Header><Card.Content><form onSubmit={event=>{event.preventDefault();if(!valid)return;setCap(capValue);setInput(capValue.toFixed(2));setMessage('Đã lưu hạn mức mẫu. Lịch sử giao dịch giữ nguyên.');persist({cap:capValue});}}><div className="h3-setting"><div><h3>Hạn mức USDC mỗi ngày</h3><p>Agent đã chi 2.40 USDC hôm nay.</p></div><div className="h3-cap-field"><Input type="number" min={2.4} max={1000000} step={.01} value={input} onChange={event=>{setInput(event.target.value);setMessage('Thay đổi chỉ áp dụng trong concept.');}} aria-label="Hạn mức USDC mỗi ngày" aria-describedby="h3-policy-message" aria-invalid={!valid}/><span>USDC</span></div></div><div className="h3-setting"><div><h3>Hợp đồng được cho phép</h3><p>Vault kiểm tra chính sách trước khi thực thi.</p></div><Chip variant="secondary" size="lg">MockRouter · DEMO</Chip></div><div className="h3-setting"><div><h3>Trạng thái agent</h3><p>Tạm dừng không thay đổi quyền sở hữu tài sản.</p></div><Switch size="lg" isSelected={active} onChange={setPendingActive}><Switch.Content aria-label="Cho phép agent hoạt động"><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div><div className="h3-policy-footer"><Button type="submit" size="lg" isDisabled={!valid||Math.abs(capValue-cap)<.00001}>Lưu thay đổi mẫu</Button><span id="h3-policy-message" role="status">{valid?message:'Nhập từ 2.40 đến 1,000,000 USDC, tối đa 2 số thập phân.'}</span></div></form></Card.Content></Card>}
        <footer className="h3-footer"><span><strong>DEMO MODE</strong> · Dữ liệu mẫu, oracle, pool và kịch bản tấn công mô phỏng.</span><span>Không có tiền thật.</span></footer>
      </main>
    </div>

    <Modal.Backdrop isOpen={!!review} onOpenChange={open=>{if(!open)setReview(null);}} UNSTABLE_portalContainer={portal} className="h3-backdrop">
      <Modal.Container size="lg" placement="center"><Modal.Dialog className="h3-modal" aria-label="Chi tiết giao dịch mẫu"><Modal.CloseTrigger/>{review&&<><Modal.Header><div className="h3-modal-eyebrow">GIAO DỊCH MẪU · {review.time}</div><Modal.Heading>{review.name}</Modal.Heading><Status blocked={review.blocked}/></Modal.Header><Modal.Body><p className="h3-review-summary">{review.summary}</p><Tabs defaultSelectedKey="result" className="h3-review-tabs"><Tabs.ListContainer><Tabs.List aria-label="Thông tin kiểm tra"><Tabs.Tab id="result">Kết quả<Tabs.Indicator/></Tabs.Tab><Tabs.Tab id="simulation">Mô phỏng<Tabs.Indicator/></Tabs.Tab><Tabs.Tab id="data">Dữ liệu<Tabs.Indicator/></Tabs.Tab></Tabs.List></Tabs.ListContainer><Tabs.Panel id="result"><dl className="h3-review-facts"><div><dt>Giá trị đề xuất</dt><dd>{review.amount}</dd></div><div><dt>Verdict Guardian</dt><dd>{review.blocked?'Rủi ro cao':'Rủi ro thấp'}</dd></div><div><dt>Quy tắc</dt><dd>{review.reason}</dd></div><div><dt>Thực thi on-chain</dt><dd>{review.blocked?'Không gửi giao dịch':'Đã thực thi · mẫu'}</dd></div><div><dt>USDC trong vault</dt><dd>{review.before} → {review.after}</dd></div></dl></Tabs.Panel><Tabs.Panel id="simulation">{review.id==='lookalike'?<div className="h3-addresses"><div><span>Router đã biết</span><code>0xe20967C615e442991D468ed7f797edcAeA1771d9</code></div><div><span>Địa chỉ nhận quyền · mẫu</span><code>0xe20<mark>B4138c0216A32e59138F41071C09cA6d93</mark>1d9</code></div><p>DEMO: khớp 3 ký tự đầu + 3 ký tự cuối.</p></div>:<dl className="h3-review-facts"><div><dt>USDC trước</dt><dd>{review.before}</dd></div><div><dt>USDC sau</dt><dd>{review.after}</dd></div><div><dt>Thay đổi mWAVAX</dt><dd>{review.token}</dd></div></dl>}</Tabs.Panel><Tabs.Panel id="data"><pre className="h3-raw">{JSON.stringify({demo:true,scenario:review.id,risk:review.blocked?'HIGH':'LOW',execution:review.blocked?'NOT_SUBMITTED':'EXECUTED_SAMPLE',decisionSource:'deterministic_rules',llmRole:'explanation_only',chainId:43113},null,2)}</pre></Tabs.Panel></Tabs></Modal.Body><Modal.Footer><span className="h3-modal-note">Minh hoạ · không gửi giao dịch</span><Button variant="secondary" onPress={()=>setReview(null)}>Đóng</Button></Modal.Footer></>}</Modal.Dialog></Modal.Container>
    </Modal.Backdrop>

    <Modal.Backdrop isOpen={checking} onOpenChange={setChecking} UNSTABLE_portalContainer={portal} className="h3-backdrop"><Modal.Container size="md" placement="center"><Modal.Dialog className="h3-modal" aria-label="Chọn giao dịch mẫu"><Modal.CloseTrigger/><Modal.Header><div className="h3-modal-eyebrow">GUARDIAN · DEMO</div><Modal.Heading>Khám phá một kiểm tra</Modal.Heading></Modal.Header><Modal.Body><p className="h3-review-summary">Chọn giao dịch để xem kết quả có sẵn. Không chạy mô phỏng hay giao dịch thật.</p><div className="h3-scenarios">{entries.slice(0,3).map(entry=><Button key={entry.id} variant="secondary" fullWidth size="lg" onPress={()=>{setChecking(false);setReview(entry);}}><span>{entry.id==='lookalike'?'Cấp quyền cho địa chỉ nhái':entry.id==='slippage'?'Swap có trượt giá cao':'Swap 2 USDC → mWAVAX'}</span><span aria-hidden="true">→</span></Button>)}</div></Modal.Body><Modal.Footer><Button variant="ghost" onPress={()=>setChecking(false)}>Huỷ</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>

    <Modal.Backdrop isOpen={pendingActive!==null} onOpenChange={open=>{if(!open)setPendingActive(null);}} UNSTABLE_portalContainer={portal} className="h3-backdrop"><Modal.Container size="md" placement="center"><Modal.Dialog className="h3-modal" aria-label="Đổi trạng thái agent"><Modal.CloseTrigger/><Modal.Header><Modal.Heading>{pendingActive?'Tiếp tục agent?':'Tạm dừng agent?'}</Modal.Heading></Modal.Header><Modal.Body><p className="h3-review-summary">{pendingActive?'Agent có thể tiếp tục gửi giao dịch trong giới hạn của vault.':'Giao dịch mới của agent sẽ bị từ chối. Chủ ví vẫn giữ quyền kiểm soát tài sản.'} Thao tác chỉ mô phỏng trong concept.</p></Modal.Body><Modal.Footer><Button variant="secondary" onPress={()=>setPendingActive(null)}>Huỷ</Button><Button variant={pendingActive?'primary':'danger'} onPress={()=>{const value=!!pendingActive;setActive(value);setPendingActive(null);persist({active:value});}}>{pendingActive?'Tiếp tục agent':'Tạm dừng agent'}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
  </div>;
}

export function mount(host:HTMLElement) {
  const shadow=host.shadowRoot||host.attachShadow({mode:'open'});
  const template=document.getElementById('guardian-heroui-style') as HTMLTemplateElement;
  shadow.append(template.content.cloneNode(true));
  const theme=document.createElement('div');theme.className='light h3-theme';theme.setAttribute('data-theme','light');
  const target=document.createElement('div');const portal=document.createElement('div');portal.className='h3-portal';
  theme.append(target,portal);shadow.append(theme);
  createRoot(target).render(<App portal={portal}/>);
}
