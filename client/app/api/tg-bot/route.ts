/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ASK_OPENAI_AGENT_PROMPT } from "./../../../prompts/prompts";
import { NextRequest, NextResponse } from 'next/server';
import { Account, Contract, RpcProvider, constants, ec, json, stark, hash, CallData } from "starknet";
import axios, { AxiosError, AxiosResponse } from 'axios';
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, PromptTemplate } from "@langchain/core/prompts";

const askAgentPromptTemplate = ChatPromptTemplate.fromMessages([
  [
    "system", ASK_OPENAI_AGENT_PROMPT
  ],
  [
    "user", "{user_query}"
  ]
]);

class StarknetWallet {
  private provider: RpcProvider;

  constructor() {
    this.provider = new RpcProvider({
      nodeUrl: process.env.STARKNET_RPC_URL || "https://starknet-mainnet.public.blastapi.io"
    });
  }

  async createWallet(): Promise<{
    account: Account, 
    privateKey: string, 
    publicKey: string, 
    contractAddress: string
  }> {
    const argentXaccountClassHash = '0x1a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003';
    const privateKeyAX = stark.randomAddress();
    const starkKeyPubAX = ec.starkCurve.getStarkKey(privateKeyAX);
    
    const AXConstructorCallData = CallData.compile({
      owner: starkKeyPubAX,
      guardian: '0',
    });
    
    const AXcontractAddress = hash.calculateContractAddressFromHash(
      starkKeyPubAX,
      argentXaccountClassHash,
      AXConstructorCallData,
      0
    );
    
    const accountAX = new Account(this.provider, AXcontractAddress, privateKeyAX);
    
    const deployAccountPayload = {
      classHash: argentXaccountClassHash,
      constructorCalldata: AXConstructorCallData,
      contractAddress: AXcontractAddress,
      addressSalt: starkKeyPubAX,
    };
    
    const { transaction_hash: AXdAth, contract_address: AXcontractFinalAddress } =
      await accountAX.deployAccount(deployAccountPayload);
    
    console.log('✅ ArgentX wallet deployed at:', AXcontractFinalAddress);
    
    return {
      account: accountAX,
      privateKey: privateKeyAX,
      publicKey: starkKeyPubAX,
      contractAddress: AXcontractFinalAddress
    };
  }

  async executeTransaction(account: Account, transactions: any[]) {
    try {
      const multicallTx = await account.execute(transactions);
      await account.waitForTransaction(multicallTx.transaction_hash);
      return multicallTx.transaction_hash;
    } catch (error) {
      console.error("Transaction execution error:", error);
      throw error;
    }
  }
}

interface Message {
  chat: {
    id: number;
    type?: 'private' | 'group' | 'supergroup';
  };
  from?: {
    id: number;
    username?: string;
  };
  text?: string;
}

interface ChatMemberUpdate {
  chat: {
    id: number;
  };
  from: {
    id: number;
    username?: string;
  };
  new_chat_member: {
    status: 'member' | 'kicked' | 'left' | 'banned';
    user: {
      id: number;
      username?: string;
    };
  };
}

interface TelegramUpdate {
  message?: Message;
  my_chat_member?: ChatMemberUpdate;
}

interface UserState {
  pendingTransaction: any;
  mode: 'ask' | 'transaction' | 'none';
  lastActivity: number;
  groupChat?: boolean;
  connectedWallet?: string;
  privateKey?: string;
}

interface UserStates {
  [key: string]: UserState;
}

type CommandHandler = {
  execute: (messageObj: Message, input?: string) => Promise<AxiosResponse>;
  requiresInput: boolean;
  prompt?: string;
}

const userStates: UserStates = {};
const TIMEOUT = 30 * 60 * 1000;

const MY_TOKEN = process.env.MY_TOKEN || '';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const BRIAN_API_KEY = process.env.BRIAN_API_KEY || '';
const BASE_URL = `https://api.telegram.org/bot${MY_TOKEN}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const BRIAN_DEFAULT_RESPONSE = "🤖 Sorry, I don’t know how to answer. The AskBrian feature allows you to ask for information on a custom-built knowledge base of resources. Contact the Brian team if you want to add new resources!";
const BRIAN_API_URL = {
  knowledge: 'https://api.brianknows.org/api/v0/agent/knowledge',
  parameters: 'https://api.brianknows.org/api/v0/agent/parameters-extraction',
  transaction: 'https://api.brianknows.org/api/v0/agent'
};

const agent = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.5,
  openAIApiKey: OPENAI_API_KEY
});

class StarknetTransactionHandler {
  private provider: RpcProvider;
  private wallet: StarknetWallet;

  constructor() {
    this.provider = new RpcProvider({
      nodeUrl: process.env.STARKNET_RPC_URL || "https://starknet-mainnet.public.blastapi.io"
    });
    this.wallet = new StarknetWallet();
  }

  async getTokenBalance(tokenAddress: string, userAddress: string): Promise<string> {
    try {
      const erc20Abi = [
        {
          name: "balanceOf",
          type: "function",
          inputs: [{ name: "account", type: "felt" }],
          outputs: [{ name: "balance", type: "Uint256" }],
          stateMutability: "view"
        }
      ];

      const contract = new Contract(erc20Abi, tokenAddress, this.provider);
      const balance = await contract.balanceOf(userAddress);
      return balance.toString();
    } catch (error) {
      console.error('Error getting token balance:', error);
      throw error;
    }
  }

  async processTransaction(brianResponse: any, privateKey: string) {
    try {
      const account = await this.wallet.createWallet();
      const transactions = brianResponse.data.steps.map((step: any) => ({
        contractAddress: step.contractAddress,
        entrypoint: step.entrypoint,
        calldata: step.calldata
      }));

      const txHash = await this.wallet.executeTransaction(account.account, transactions);

      return {
        success: true,
        description: brianResponse.data.description,
        transactions,
        action: brianResponse.action,
        solver: brianResponse.solver,
        fromToken: brianResponse.data.fromToken,
        toToken: brianResponse.data.toToken,
        fromAmount: brianResponse.data.fromAmount,
        toAmount: brianResponse.data.toAmount,
        receiver: brianResponse.data.receiver,
        estimatedGas: brianResponse.data.gasCostUSD,
        transactionHash: txHash
      };
    } catch (error) {
      console.error('Error processing transaction:', error);
      throw error;
    }
  }
}

const axiosInstance = {
  get: async (method: string, params: Record<string, unknown>): Promise<AxiosResponse> => {
    try {
      const response = await axios.get(`${BASE_URL}/${method}`, { params });
      return response;
    } catch (error) {
      const axiosError = error as AxiosError;
      console.error(`Axios GET error for method ${method}:`, axiosError.response?.data || axiosError.message);
      throw error;
    }
  }
};

function getUserKey(messageObj: Message): string {
  return `${messageObj.chat.id}_${messageObj.from?.id}`;
}

function isGroupChat(messageObj: Message): boolean {
  return messageObj.chat.type === 'group' || messageObj.chat.type === 'supergroup';
}

async function formatBrianResponse(response: string): string {
  // Remove unnecessary quotation marks
  let formattedText = response.replace(/^"|"$/g, '').trim();
  
  // Fix markdown headers by ensuring proper spacing
  formattedText = formattedText.replace(/(\n*)###\s*/g, '\n\n### ');
  
  // Add bold formatting to the main sections
  formattedText = formattedText.replace(
    /### ([\w\s&()-]+)/g, 
    '### **$1**'
  );
  
  // Ensure proper paragraph spacing
  formattedText = formattedText.replace(/\n{3,}/g, '\n\n');
  
  // Add italics to key terms
  const keyTerms = [
    'Layer 2',
    'zk-rollups',
    'Cairo',
    'DeFi',
    'Web3',
    'dApps'
  ];
  
  keyTerms.forEach(term => {
    const regex = new RegExp(`\\b${term}\\b(?![^<]*>)`, 'g');
    formattedText = formattedText.replace(regex, `_${term}_`);
  });
  
  // Modify the sendMessage parameters to include proper markdown parsing
  return formattedText;
}

async function sendMessage(messageObj: Message, messageText: string): Promise<AxiosResponse> {
  try {
    if (!messageObj.chat.id) {
      throw new Error('Invalid chat ID');
    }
    const formattedText = messageText.includes('###') 
      ? await formatBrianResponse(messageText)
      : messageText;

    const result = await axiosInstance.get('sendMessage', {
      chat_id: messageObj.chat.id,
      text: formattedText,
      parse_mode: 'Markdown',
    });
    return result;
  } catch (error) {
    console.error('Send Message Error:', error);
    console.error('Message Details:', {
      chatId: messageObj.chat.id,
      messageText,
    });
    throw error;
  }
}

async function queryOpenAI(userQuery: string): Promise<string> {
  try {
    const prompt = askAgentPromptTemplate;
    const chain = prompt.pipe(agent)
    const response = await chain.invoke({user_query: userQuery});
    return response.content as string;
  } catch (error) {
    console.error('OpenAI Error:', error);
    return 'Sorry, I am unable to process your request at the moment.';
  }
}

async function queryBrianAI(prompt: string): Promise<string> {
  try {
    const response = await axios.post(
      BRIAN_API_URL.knowledge,
      {
        prompt,
        kb: 'starknet_kb'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-brian-api-key': BRIAN_API_KEY,
        }
      }
    );
    const answer = response.data.result.answer; 
    if (answer === BRIAN_DEFAULT_RESPONSE) {
      return queryOpenAI(prompt);
    }
    return answer;
  } catch (error) {
    console.error('Brian AI Error:', error);
    return 'Sorry, I am unable to process your request at the moment.';
  }
}

async function processTransactionRequest(messageObj: Message, prompt: string): Promise<AxiosResponse> {
  try {
    const userKey = getUserKey(messageObj);
    const userState = userStates[userKey];

    // If no wallet exists, automatically create one
    if (!userState?.connectedWallet || !userState?.privateKey) {
      const wallet = new StarknetWallet();
      const { account, privateKey, publicKey, contractAddress } = await wallet.createWallet();
      
      userStates[userKey] = {
        ...userStates[userKey] || {},
        connectedWallet: account.address,
        privateKey: privateKey,
        mode: 'none',
        lastActivity: Date.now(),
        groupChat: isGroupChat(messageObj)
      };

      await sendMessage(messageObj, `🔑 Wallet Automatically Created for Transaction
Address: \`${contractAddress}\``);
    }

    const response = await fetch(BRIAN_API_URL.transaction, {
      method: 'POST',
      headers: {
        'X-Brian-Api-Key': BRIAN_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        address: userState.connectedWallet,
        chainId: '4012',
      }),
    });

    const data = await response.json();
    
    if (!response.ok || data.error) {
      return sendMessage(messageObj, data.error || 'Failed to process transaction request');
    }

    // Preview transaction first
    const txPreview = `Transaction Preview:
Type: ${data.result[0].action}
${data.result[0].data.fromToken ? `From: ${data.result[0].data.fromAmount} ${data.result[0].data.fromToken.symbol}` : ''}
${data.result[0].data.toToken ? `To: ${data.result[0].data.toAmount} ${data.result[0].data.toToken.symbol}` : ''}
${data.result[0].data.receiver ? `Receiver: ${data.result[0].data.receiver}` : ''}
Estimated Gas: ${data.result[0].data.gasCostUSD || 'Unknown'} USD

Reply with "confirm" to execute this transaction.`;

    userStates[userKey].pendingTransaction = data.result[0];
    return sendMessage(messageObj, txPreview);

  } catch (error) {
    console.error('Transaction processing error:', error);
    return sendMessage(messageObj, 'Error processing transaction. Please try again.');
  }
}

const commandHandlers: Record<string, CommandHandler> = {
  start: {
    execute: async (messageObj) => 
      sendMessage(messageObj, `Welcome to StarkFinder! 🚀

I can help you with:
1️⃣ Starknet Information - Just ask any question!
2️⃣ Transaction Processing - Connect wallet and describe what you want to do
3️⃣ Token Balances - Check your token balances

Commands:
/wallet <private_key> - Connect your wallet
/balance [token_address] - Check token balance
/txn <description> - Create a transaction
/help - Show detailed help

Just type naturally - no need to use commands for every interaction!`),
    requiresInput: false
  },

  wallet: {
    execute: async (messageObj, input) => {
      const userKey = getUserKey(messageObj);
      
      try {
        const wallet = new StarknetWallet();
        const { account, privateKey, publicKey, contractAddress } = await wallet.createWallet();
        
        userStates[userKey] = {
          ...userStates[userKey] || {},
          connectedWallet: account.address,
          privateKey: privateKey,
          mode: 'none',
          lastActivity: Date.now(),
          groupChat: isGroupChat(messageObj)
        };

        return sendMessage(messageObj, `🚀 New Wallet Created!

*Wallet Details:*
• Address: \`${contractAddress}\`
• Public Key: \`${publicKey}\`

⚠️ *IMPORTANT*:
1. Save your private key securely
2. Do not share your private key with anyone
3. This is a one-time display of your keys

Your wallet is now ready for transactions!`);
      } catch (error) {
        console.error('Wallet creation error:', error);
        return sendMessage(messageObj, 'Error creating wallet. Please try again.');
      }
    },
    requiresInput: false,
  },

  balance: {
    execute: async (messageObj, input) => {
      const userKey = getUserKey(messageObj);
      const userState = userStates[userKey];

      if (!userState?.connectedWallet) {
        return sendMessage(messageObj, 'Please connect your wallet first using /wallet <private_key>');
      }

      try {
        const handler = new StarknetTransactionHandler();
        // Use the ETH contract address if no token address is provided
        const ETH_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
        const balance = await handler.getTokenBalance(
          input || ETH_ADDRESS,
          userState.connectedWallet
        );

        const tokenSymbol = input ? 'tokens' : 'ETH';
        return sendMessage(messageObj, `Balance: ${balance} ${tokenSymbol}`);
      } catch (error) {
        return sendMessage(messageObj, 'Error getting token balance. Please try again.');
      }
    },
    requiresInput: false
  },
  
  help: {
    execute: async (messageObj) =>
      sendMessage(messageObj, `StarkFinder Bot Guide 📚

🔍 Information Mode:
• Ask any question about Starknet
• Example: "How do accounts work?"
• Example: "What is Cairo?"

💰 Transaction Mode:
• First connect wallet: /wallet <private_key>
• Then describe your transaction
• Example: "Swap 100 ETH for USDC"
• Example: "Send 50 USDC to 0x..."

💳 Wallet Commands:
• /wallet <private_key> - Connect wallet
• /balance [token_address] - Check balance
• /txn <description> - Create transaction

⚙️ Features:
• Natural language processing
• Transaction preview
• Gas estimation
• Balance checking

Need more help? Join our support group!`),
    requiresInput: false
  },
  txn: {
    execute: async (messageObj) => 
      sendMessage(messageObj, `🚀 Transaction Processing via Mini App 📱

To create and execute transactions, please use our Telegram Mini App: [AppLink](https://t.me/starkfinder_bot/strk00)

🔗 Open StarkFinder Mini App
- Tap the button in the chat or visit @starkfinderbot
- Navigate to the Transactions section
- Follow the guided transaction flow

Benefits of Mini App:
✅ Secure transaction preview
✅ Real-time gas estimation
✅ Multi-step transaction support
✅ User-friendly interface

Need help? Contact our support team!`),
    requiresInput: false
  },
};

async function handleMessage(messageObj: Message): Promise<AxiosResponse> {
  try {
    console.log('Received Message:', JSON.stringify(messageObj, null, 2));
    if (!messageObj?.from?.id) throw new Error('Invalid message object');
    
    const userKey = getUserKey(messageObj);
    const messageText = messageObj.text?.trim() || '';
    const userState = userStates[userKey];

    if (messageText.startsWith('/')) {
      const [command, ...args] = messageText.substring(1).split(' ');
      const input = args.join(' ');
      const handler = commandHandlers[command.toLowerCase()];

      if (handler) {
        return await handler.execute(messageObj, input);
      } else {
        return await sendMessage(messageObj, 'Invalid command. Type /help for available commands.');
      }
    }

    if (userState) {
      userState.lastActivity = Date.now();

      if (messageText.toLowerCase() === 'confirm' && userState.pendingTransaction) {
        const handler = new StarknetTransactionHandler();
        try {
          const result = await handler.processTransaction(userState.pendingTransaction, userState.privateKey!);
          delete userState.pendingTransaction;
          
          return sendMessage(messageObj, `Transaction Executed! 🎉
Hash: ${result.transactionHash}
View on Starkscan: https://starkscan.co/tx/${result.transactionHash}`);
        } catch (error) {
          return sendMessage(messageObj, 'Transaction failed. Please try again.');
        }
      }

      if (messageText.toLowerCase().includes('swap') || 
          messageText.toLowerCase().includes('transfer') ||
          messageText.toLowerCase().includes('send')) {
        return await processTransactionRequest(messageObj, messageText);
      } else {
        const response = await queryBrianAI(messageText);
        return sendMessage(messageObj, response);
      }
    } else {
      // New user, create state and handle message
      userStates[userKey] = {
        pendingTransaction: null,
        mode: 'none',
        lastActivity: Date.now(),
        groupChat: isGroupChat(messageObj)
      };
      
      const response = await queryBrianAI(messageText);
      return sendMessage(messageObj, response);
    }
  } catch (error) {
    console.error('Handle Message Error:', error);
    console.error('Full Error Details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return sendMessage(messageObj, 'An error occurred. Please try again.');
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as TelegramUpdate;
    
    if (!body) {
      return NextResponse.json({ ok: false, error: 'No body received' });
    }
    
    if (body.message) {
      await handleMessage(body.message);
    } 
    
    if (body.my_chat_member) {
      // Handle member updates if needed
    }
    
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ 
      ok: false, 
      error: (error as Error).message 
    });
  }
}